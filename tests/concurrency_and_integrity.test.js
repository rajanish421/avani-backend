const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const app = require('../src/app');
const { db } = require('../src/config/firebase');

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

test('Concurrent Registration, Counter Integrity, and Rollback Suite', async (t) => {
  await t.test('1. Concurrent registrations assign unique consecutive IDs without duplicate IDs', async () => {
    const counterDocBefore = await db.collection('system_counters').doc('student_id').get();
    const initialCounter = counterDocBefore.data()?.currentValue || 0;

    const numConcurrent = 4;
    const promises = [];
    const baseSuffix = Date.now().toString().slice(-5);

    for (let i = 0; i < numConcurrent; i++) {
      const payload = {
        requestId: `req_concurrent_${baseSuffix}_${i}`,
        name: `Concurrent Student ${i}`,
        registrationNo: `CONC-REG-${baseSuffix}-${i}`,
        dob: `0${i + 1}/05/2004`,
        course: 'DCA',
        batch: 'Batch A (Oct 2025)',
        admissionDate: '10/10/2026',
        totalFee: 12000,
        downPayment: 3000,
      };

      promises.push(
        fetch(`${baseUrl}/api/students/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer mock_admin_test_admin',
          },
          body: JSON.stringify(payload),
        }).then(async (r) => {
          const json = await r.json();
          return { status: r.status, json };
        })
      );
    }

    const results = await Promise.all(promises);
    const studentIds = [];

    for (const res of results) {
      assert.equal(res.status, 201, `Concurrent request failed: ${JSON.stringify(res.json)}`);
      assert.ok(res.json.studentId);
      studentIds.push(res.json.studentId);
    }

    // Ensure all assigned Student IDs are unique
    const uniqueIds = new Set(studentIds);
    assert.equal(uniqueIds.size, numConcurrent, 'All concurrent registrations must receive unique Student IDs');

    // Verify counter increment matches exact number of registrations
    const counterDocAfter = await db.collection('system_counters').doc('student_id').get();
    const finalCounter = counterDocAfter.data()?.currentValue || 0;
    assert.equal(finalCounter, initialCounter + numConcurrent, 'Counter must increment exactly by concurrent batch size');
  });

  await t.test('2. Transaction abort / invalid payload leaves counter unchanged (no skipped or burned IDs)', async () => {
    const counterDocBefore = await db.collection('system_counters').doc('student_id').get();
    const counterBefore = counterDocBefore.data()?.currentValue || 0;

    // Send invalid payload (missing required DOB)
    const badPayload = {
      requestId: `req_fail_${Date.now()}`,
      name: 'Failed Student',
      registrationNo: `FAIL-REG-${Date.now()}`,
      course: 'DCA',
      // missing dob
    };

    const res = await fetch(`${baseUrl}/api/students/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mock_admin_test_admin',
      },
      body: JSON.stringify(badPayload),
    });

    assert.equal(res.status, 400);

    const counterDocAfter = await db.collection('system_counters').doc('student_id').get();
    const counterAfter = counterDocAfter.data()?.currentValue || 0;
    assert.equal(counterAfter, counterBefore, 'Failed request must not increment or burn the student ID sequence counter');
  });
});
