const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const app = require('../src/app');
const { db, apiKey } = require('../src/config/firebase');

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.ALLOW_TEST_AUTH = 'true';

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Student Registration, Idempotency, Counter Integrity, and Auth Suite', async (t) => {
  const uniqueSuffix = Date.now().toString().slice(-6);
  const testRegNo1 = `TEST-REG-${uniqueSuffix}-A`;
  const testRegNo2 = `TEST-REG-${uniqueSuffix}-B`;
  const requestId1 = `req_test_${crypto.randomUUID()}`;

  let createdStudentId1;
  let createdUid1;
  let createdTempPassword1;
  let test3StudentId;

  await t.test('1. Successful student registration generates correct Student ID and DOB password', async () => {
    const payload = {
      requestId: requestId1,
      name: 'Rohan Sharma',
      registrationNo: testRegNo1,
      dob: '15/08/2005', // DOB in DD/MM/YYYY
      course: 'DCA',
      batch: 'Batch A (Oct 2025)',
      admissionDate: '10/10/2026',
      totalFee: 15000,
      downPayment: 5000,
      phone: '9876543210',
      email: `rohan.${uniqueSuffix}@example.com`,
    };

    const res = await fetch(`${baseUrl}/api/students/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mock_admin_test_admin',
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    assert.equal(res.status, 201, `Failed to register student: ${JSON.stringify(json)}`);
    assert.equal(json.success, true);
    assert.match(json.studentId, /^ACI\d{5}$/, 'Student ID should match pattern ACI0000X');
    assert.equal(json.tempPassword, '15082005', 'Password should be DOB in DDMMYYYY format');
    assert.equal(json.mustChangePassword, true, 'mustChangePassword should be true on registration');

    createdStudentId1 = json.studentId;
    createdUid1 = json.uid;
    createdTempPassword1 = json.tempPassword;

    // Verify record in Firestore
    const studentDoc = await db.collection('students').doc(createdUid1).get();
    assert.equal(studentDoc.exists, true);
    assert.equal(studentDoc.data().studentId, createdStudentId1);
    assert.equal(studentDoc.data().mustChangePassword, true);
    assert.equal(studentDoc.data().registrationNo, testRegNo1);
    assert.equal(studentDoc.data().dob, '15/08/2005');
    assert.equal(studentDoc.data().rollNo, createdStudentId1);
    assert.equal(studentDoc.data().dateOfBirth, undefined);
    assert.equal(studentDoc.data().rollNumber, undefined);
  });

  await t.test('2. Idempotent retry with exact same requestId returns same student without incrementing counter', async () => {
    const counterBefore = (await db.collection('system_counters').doc('student_id').get()).data()?.currentValue;

    const payload = {
      requestId: requestId1, // Identical requestId
      name: 'Rohan Sharma',
      registrationNo: testRegNo1,
      dob: '15/08/2005',
      course: 'DCA',
      batch: 'Batch A (Oct 2025)',
      admissionDate: '10/10/2026',
      totalFee: 15000,
      downPayment: 5000,
    };

    const res = await fetch(`${baseUrl}/api/students/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mock_admin_test_admin',
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    assert.equal(res.status, 201);
    assert.equal(json.success, true);
    assert.equal(json.idempotent, true, 'Should indicate idempotent response');
    assert.equal(json.studentId, createdStudentId1, 'Should return same Student ID');

    const counterAfter = (await db.collection('system_counters').doc('student_id').get()).data()?.currentValue;
    assert.equal(counterAfter, counterBefore, 'Counter must not increment on idempotent retry');
  });

  await t.test('3. Registration number is stored on student profile as a student detail (not a key constraint)', async () => {
    const customRegPayload = {
      requestId: `req_custom_${crypto.randomUUID()}`,
      name: 'Second Student',
      registrationNo: testRegNo1, // Can be assigned as informational detail
      dob: '01/01/2004',
      course: 'DCA',
      admissionDate: '10/10/2026',
      totalFee: 10000,
    };

    const res = await fetch(`${baseUrl}/api/students/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mock_admin_test_admin',
      },
      body: JSON.stringify(customRegPayload),
    });

    const json = await res.json();
    assert.equal(res.status, 201, `Failed to register second student: ${JSON.stringify(json)}`);
    assert.equal(json.success, true);
    test3StudentId = json.studentId;

    const doc = await db.collection('students').doc(json.uid).get();
    assert.equal(doc.exists, true);
    assert.equal(doc.data().registrationNo, testRegNo1);
    assert.equal(doc.data().dob, '01/01/2004');
  });

  await t.test('4. Registration status endpoint retrieves existing registration details', async () => {
    const res = await fetch(`${baseUrl}/api/students/registration-status/${requestId1}`, {
      headers: {
        Authorization: 'Bearer mock_admin_test_admin',
      },
    });

    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.found, true);
    assert.equal(json.status, 'COMPLETED');
    assert.equal(json.studentId, createdStudentId1);
  });

  await t.test('5. Second student registration increments sequence counter sequentially', async () => {
    const requestId2 = `req_test_${crypto.randomUUID()}`;
    const payload2 = {
      requestId: requestId2,
      name: 'Priya Verma',
      registrationNo: testRegNo2,
      dob: '20-11-2006', // DOB in DD-MM-YYYY
      course: 'ADCA',
      batch: 'Batch A (Oct 2025)',
      admissionDate: '10/10/2026',
      totalFee: 18000,
      downPayment: 6000,
    };

    const res = await fetch(`${baseUrl}/api/students/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mock_admin_test_admin',
      },
      body: JSON.stringify(payload2),
    });

    const json = await res.json();
    assert.equal(res.status, 201, `Failed to register student in Test 5: ${JSON.stringify(json)}`);
    assert.equal(json.tempPassword, '20112006');

    // Extract sequence numbers
    const numPrev = parseInt((test3StudentId || createdStudentId1).replace('ACI', ''), 10);
    const num2 = parseInt(json.studentId.replace('ACI', ''), 10);
    assert.equal(num2, numPrev + 1, 'Next Student ID must be strictly sequential (counter + 1)');
  });

  await t.test('6. Direct Firebase Auth SDK sign-in with deterministic student alias and DOB succeeds', async () => {
    const directEmail = `${createdStudentId1.toLowerCase()}@students.avani.internal`;

    const directAuthRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: directEmail,
          password: createdTempPassword1,
          returnSecureToken: true,
        }),
      }
    );

    const directJson = await directAuthRes.json();
    assert.equal(directAuthRes.status, 200, `Direct Firebase Auth failed: ${JSON.stringify(directJson)}`);
    assert.ok(directJson.idToken, 'Firebase Auth must issue ID token directly to student');
    assert.equal(directJson.email.toLowerCase(), directEmail.toLowerCase());

    // Verify student document in Firestore has mustChangePassword=true
    const studentDoc = await db.collection('students').doc(createdUid1).get();
    assert.equal(studentDoc.data().mustChangePassword, true, 'Initial login must require password change');
  });

  await t.test('7. Direct Firebase Auth sign-in with wrong password fails', async () => {
    const directEmail = `${createdStudentId1.toLowerCase()}@students.avani.internal`;

    const directAuthRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: directEmail,
          password: 'wrong_password_999',
          returnSecureToken: true,
        }),
      }
    );

    assert.equal(directAuthRes.status, 400);
    const errJson = await directAuthRes.json();
    assert.ok(
      errJson.error.message.includes('INVALID_PASSWORD') ||
      errJson.error.message.includes('INVALID_LOGIN_CREDENTIALS')
    );
  });

  await t.test('8. Registration is rejected with 400 and BATCH_CAPACITY_FULL when batch is full', async () => {
    const testBatchId = `batch_full_test_${uniqueSuffix}`;
    const batchDocRef = db.collection('batches').doc(testBatchId);
    await batchDocRef.set({
      name: `Full Test Batch ${uniqueSuffix}`,
      course: 'DCA',
      capacity: 1,
      enrolled: 1,
      assignedStudentIds: ['existing_student_001'],
      status: 'Active',
    });

    try {
      const fullRegRes = await fetch(`${baseUrl}/api/students/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock_admin_test_admin',
        },
        body: JSON.stringify({
          requestId: `req_test_full_${crypto.randomUUID()}`,
          name: 'Over Capacity Candidate',
          registrationNo: `REG-FULL-${uniqueSuffix}`,
          dob: '01/01/2004',
          course: 'DCA',
          batch: testBatchId,
          admissionDate: '10/10/2026',
          totalFee: 15000,
          downPayment: 5000,
          phone: '9876543299',
          email: `overcapacity.${uniqueSuffix}@example.com`,
        }),
      });

      const fullJson = await fullRegRes.json();
      assert.equal(fullRegRes.status, 400, 'Must reject registration with HTTP 400 when batch is full');
      assert.equal(fullJson.errorCode, 'BATCH_CAPACITY_FULL', 'Must return BATCH_CAPACITY_FULL error code');
      assert.ok(fullJson.error.includes('reached full capacity'), 'Error message must clearly mention full capacity');
    } finally {
      await batchDocRef.delete().catch(() => {});
    }
  });

  await t.test('9. Admin resets student password with Temporary Password (mustChangePassword=true)', async () => {
    const newTempPass = 'TempResetPass123';
    const resetRes = await fetch(`${baseUrl}/api/students/admin-reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mock_admin_test_admin',
      },
      body: JSON.stringify({
        studentUid: createdUid1,
        studentId: createdStudentId1,
        newPassword: newTempPass,
        isTemporary: true,
      }),
    });

    const resetData = await resetRes.json();
    assert.equal(resetRes.status, 200);
    assert.equal(resetData.success, true);
    assert.equal(resetData.mustChangePassword, true);

    // Verify student can sign in to Firebase Auth directly with new temporary password
    const directEmail = `${createdStudentId1.toLowerCase()}@students.avani.internal`;
    const directAuthRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: directEmail,
          password: newTempPass,
          returnSecureToken: true,
        }),
      }
    );
    const directJson = await directAuthRes.json();
    assert.equal(directAuthRes.status, 200, `Sign-in with new temp password failed: ${JSON.stringify(directJson)}`);

    // Verify Firestore reflects mustChangePassword: true and incremented sessionVersion
    const studentDoc = await db.collection('students').doc(createdUid1).get();
    assert.equal(studentDoc.data().mustChangePassword, true, 'Student must be forced to change password');
    assert.equal(studentDoc.data().forceSessionRelogin, true);
  });

  await t.test('10. Admin resets student password with Permanent Password in privacy mode (mustChangePassword=false)', async () => {
    const newPermPass = 'PermanentStudentPass456';
    const resetRes = await fetch(`${baseUrl}/api/students/admin-reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mock_admin_test_admin',
      },
      body: JSON.stringify({
        studentUid: createdUid1,
        studentId: createdStudentId1,
        newPassword: newPermPass,
        isTemporary: false,
      }),
    });

    const resetData = await resetRes.json();
    assert.equal(resetRes.status, 200);
    assert.equal(resetData.success, true);
    assert.equal(resetData.mustChangePassword, false);

    // Verify student can sign in to Firebase Auth directly with permanent password
    const directEmail = `${createdStudentId1.toLowerCase()}@students.avani.internal`;
    const directAuthRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: directEmail,
          password: newPermPass,
          returnSecureToken: true,
        }),
      }
    );
    const directJson = await directAuthRes.json();
    assert.equal(directAuthRes.status, 200, `Sign-in with permanent password failed: ${JSON.stringify(directJson)}`);

    // Verify Firestore reflects mustChangePassword: false
    const studentDoc = await db.collection('students').doc(createdUid1).get();
    assert.equal(studentDoc.data().mustChangePassword, false, 'Student does NOT need to change password in privacy mode');
  });
});
