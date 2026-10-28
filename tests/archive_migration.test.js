const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.NODE_ENV = 'test';
process.env.ALLOW_TEST_AUTH = 'true';
// For local integration testing, use local running mongod if Atlas is not reachable
process.env.MONGODB_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/avani_institute_archive_test';

const app = require('../src/app');
const { db } = require('../src/config/firebase');
const { connectMongo, disconnectMongo } = require('../src/config/mongodb');
const ArchivedStudent = require('../src/models/ArchivedStudent');
const ArchivedBatch = require('../src/models/ArchivedBatch');
const MigrationAuditLog = require('../src/models/MigrationAuditLog');
const ArchiveMigrationService = require('../src/services/archiveMigrationService');

const PORT = 5055;
let server;
const baseUrl = `http://localhost:${PORT}`;

test.before(async () => {
  await connectMongo();
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await disconnectMongo();
});

test('=== Archive & Migration System Suite (MongoDB + Firestore) ===', async (t) => {
  const testStudentUid = `test_mig_stu_${Date.now()}`;
  const testStudentId = `ACI99991`;
  const testBatchId = `test_mig_batch_${Date.now()}`;
  const batchWiseTestId = `test_exam_batchwise_${Date.now()}`;
  const allBatchesTestId = `test_exam_allbatches_${Date.now()}`;
  const otherBatchTestId = `test_exam_otherbatch_${Date.now()}`;
  const batchAttDocId = `test_att_batch_${Date.now()}`;
  const otherAttDocId = `test_att_other_${Date.now()}`;
  const studentPaymentId = `test_pay_${Date.now()}`;
  const studentSubId = `test_sub_${Date.now()}`;
  let executedMigrationId = null;

  // Setup mock batch & student in Firestore
  await t.test('0. Setup test batch and student fixtures in Firestore', async () => {
    await db.collection('batches').doc(testBatchId).set({
      id: testBatchId,
      batchId: testBatchId,
      code: 'TEST-DCA-01',
      name: 'Test DCA Evening Batch',
      course: 'Diploma in Computer Application',
      timeSlot: '05:00 PM - 06:30 PM',
      days: ['Mon', 'Wed', 'Fri'],
      trainer: 'Test Faculty',
      capacity: 25,
      status: 'Active',
      startDate: '2026-01-01',
      endDate: '2026-10-25',
      assignedStudentIds: [testStudentUid],
    });

    await db.collection('students').doc(testStudentUid).set({
      id: testStudentUid,
      uid: testStudentUid,
      studentId: testStudentId,
      rollNo: testStudentId,
      name: 'Rohan Sharma',
      email: 'rohan.sharma@example.com',
      phone: '+91 9988776655',
      dob: '2003-05-15',
      course: 'Diploma in Computer Application',
      batch: 'Test DCA Evening Batch',
      batchId: testBatchId,
      admissionDate: '2026-01-05',
      status: 'Active',
      totalFees: 15000,
      paidFees: 10000,
      pendingFees: 5000,
      attendancePct: 85,
    });

    await db.collection('fee_accounts').doc(`fee_${testStudentUid}`).set({
      studentUid: testStudentUid,
      studentId: testStudentId,
      totalFee: 15000,
      paidFee: 10000,
      pendingFee: 5000,
      status: 'Partial',
      installments: [
        { installmentNo: 1, amount: 5000, status: 'Paid', dueDate: '2026-01-15' },
        { installmentNo: 2, amount: 5000, status: 'Paid', dueDate: '2026-04-15' },
        { installmentNo: 3, amount: 5000, status: 'Pending', dueDate: '2026-07-15' },
      ],
    });

    await db.collection('enrollments').doc(`enr_${testStudentUid}`).set({
      studentUid: testStudentUid,
      studentId: testStudentId,
      course: 'Diploma in Computer Application',
      batch: 'Test DCA Evening Batch',
      status: 'Active',
    });

    await db.collection('fee_payments').doc(studentPaymentId).set({
      id: studentPaymentId,
      studentUid: testStudentUid,
      studentRoll: testStudentId,
      amount: 5000,
      status: 'Approved',
      receiptNo: 'REC-TEST-99991-01',
    });

    await db.collection('test_submissions').doc(studentSubId).set({
      id: studentSubId,
      studentUid: testStudentUid,
      studentRoll: testStudentId,
      testId: batchWiseTestId,
      score: 85,
    });

    // 1) Batch-wise test for THIS batch
    await db.collection('tests').doc(batchWiseTestId).set({
      id: batchWiseTestId,
      title: 'DCA Module 1 Internal Exam',
      targetType: 'batch',
      batch: 'Test DCA Evening Batch',
      batchId: testBatchId,
      status: 'Completed',
    });

    // 2) General test for ALL batches
    await db.collection('tests').doc(allBatchesTestId).set({
      id: allBatchesTestId,
      title: 'Annual Institute General Assessment',
      targetType: 'all',
      status: 'Scheduled',
    });

    // 3) Batch-wise test for ANOTHER batch
    await db.collection('tests').doc(otherBatchTestId).set({
      id: otherBatchTestId,
      title: 'Java Morning Quiz',
      targetType: 'batch',
      batch: 'Morning Java Batch',
      batchId: 'other_batch_id_999',
      status: 'Scheduled',
    });

    // 4) Attendance for THIS batch
    await db.collection('attendance').doc(batchAttDocId).set({
      id: batchAttDocId,
      batchId: testBatchId,
      batch: 'Test DCA Evening Batch',
      studentUid: testStudentUid,
      status: 'present',
    });

    // 5) Attendance for OTHER batch
    await db.collection('attendance').doc(otherAttDocId).set({
      id: otherAttDocId,
      batchId: 'other_batch_id_999',
      batch: 'Morning Java Batch',
      studentUid: 'other_student_uid_777',
      status: 'present',
    });
  });

  // 1. Health check includes MongoDB status
  await t.test('1. GET /api/health exposes MongoDB and Firestore connectivity', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.database.firestore, 'connected');
    assert.equal(body.database.mongodb, 'connected');
  });

  // 2. Pre-flight preview for single student
  await t.test('2. GET /api/archive/student/:studentUid/preview returns accurate pre-flight audit', async () => {
    const res = await fetch(`${baseUrl}/api/archive/student/${testStudentUid}/preview`, {
      headers: { Authorization: 'Bearer mock_admin_master' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.studentUid, testStudentUid);
    assert.equal(body.data.studentId, testStudentId);
    assert.equal(body.data.feeStatus.totalFee, 15000);
    assert.equal(body.data.feeStatus.paidFee, 10000);
    assert.equal(body.data.feeStatus.pendingFee, 5000);
    assert.ok(body.data.warnings.length > 0, 'Should warn about pending fees');
  });

  // 3. Pre-flight preview for batch
  await t.test('3. GET /api/archive/batch/:batchId/preview audits entire batch', async () => {
    const res = await fetch(`${baseUrl}/api/archive/batch/${testBatchId}/preview`, {
      headers: { Authorization: 'Bearer mock_admin_master' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.batchId, testBatchId);
    assert.equal(body.data.totalStudents, 1);
    assert.equal(body.data.feeOverview.studentsWithPendingFees, 1);
  });

  // 4. Migrate student to MongoDB and prune Firestore operational records
  await t.test('4. POST /api/archive/student/:studentUid/execute migrates student with checksum verification', async () => {
    const res = await fetch(`${baseUrl}/api/archive/student/${testStudentUid}/execute`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer mock_admin_master',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ force: true }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.verified, true);
    executedMigrationId = body.data.migrationId;

    // Verify MongoDB document
    const mongoDoc = await ArchivedStudent.findOne({ studentUid: testStudentUid });
    assert.ok(mongoDoc, 'Student document must exist in MongoDB');
    assert.equal(mongoDoc.studentId, testStudentId);
    assert.equal(mongoDoc.status, 'Completed');
    assert.equal(mongoDoc.feeSummary.totalFee, 15000);
    assert.equal(mongoDoc.feeSummary.pendingFee, 5000);

    // Verify Firestore Student is completely pruned/deleted to reduce database storage to zero
    const fsStudentDoc = await db.collection('students').doc(testStudentUid).get();
    assert.equal(fsStudentDoc.exists, false, 'Student document must be completely pruned from Firestore to reduce storage');

    // Verify operational fee account is safely pruned from Firestore
    const fsFeeDoc = await db.collection('fee_accounts').doc(`fee_${testStudentUid}`).get();
    assert.equal(fsFeeDoc.exists, false, 'Operational fee account should be pruned from Firestore');

    // Verify enrollment is pruned
    const fsEnrDoc = await db.collection('enrollments').doc(`enr_${testStudentUid}`).get();
    assert.equal(fsEnrDoc.exists, false, 'Operational enrollment should be pruned from Firestore');
  });

  // 5. Idempotent re-run safety
  await t.test('5. Re-executing migration for already archived student is completely idempotent', async () => {
    const res = await fetch(`${baseUrl}/api/archive/student/${testStudentUid}/execute`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer mock_admin_master',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ force: true }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    const count = await ArchivedStudent.countDocuments({ studentUid: testStudentUid });
    assert.equal(count, 1, 'Idempotent upsert must not create duplicate records in MongoDB');
  });

  // 6. Archived student query via Admin API
  await t.test('6. GET /api/archive/students retrieves paginated completed students from MongoDB', async () => {
    const res = await fetch(`${baseUrl}/api/archive/students?search=Rohan`, {
      headers: { Authorization: 'Bearer mock_admin_master' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.students.length >= 1);
    const student = body.data.students.find((s) => s.studentUid === testStudentUid);
    assert.ok(student);
    assert.equal(student.studentId, testStudentId);
  });

  // 7. Student App authenticated archive retrieval
  await t.test('7. GET /api/archive/student/my-record allows authenticated student to fetch completed archive', async () => {
    const res = await fetch(`${baseUrl}/api/archive/student/my-record`, {
      headers: { Authorization: `Bearer mock_student_${testStudentUid}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.studentUid, testStudentUid);
    assert.equal(body.data.status, 'Completed');
    assert.equal(body.data.feeSummary.totalFee, 15000);
  });

  // 8. Batch migration
  await t.test('8. POST /api/archive/batch/:batchId/execute archives batch to MongoDB', async () => {
    const res = await fetch(`${baseUrl}/api/archive/batch/${testBatchId}/execute`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer mock_admin_master',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ force: true }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.batchId, testBatchId);

    // Verify MongoDB ArchivedBatch
    const mongoBatch = await ArchivedBatch.findOne({ batchId: testBatchId });
    assert.ok(mongoBatch);
    assert.equal(mongoBatch.status, 'Archived');

    // Verify Firestore Batch is completely pruned/deleted to reduce database storage to zero
    const fsBatch = await db.collection('batches').doc(testBatchId).get();
    assert.equal(fsBatch.exists, false, 'Batch document must be completely pruned from Firestore to reduce storage');

    // Verify batch-wise test is deleted, but 'all' batches test and other-batch test remain untouched!
    const batchTestDoc = await db.collection('tests').doc(batchWiseTestId).get();
    assert.equal(batchTestDoc.exists, false, 'Batch-wise test must be pruned when batch is migrated');

    const allBatchesDoc = await db.collection('tests').doc(allBatchesTestId).get();
    assert.equal(allBatchesDoc.exists, true, 'Test for ALL batches must NOT be deleted');

    const otherBatchDoc = await db.collection('tests').doc(otherBatchTestId).get();
    assert.equal(otherBatchDoc.exists, true, 'Test for another batch must NOT be deleted');

    // Verify batch attendance is deleted, but other-batch attendance remains untouched!
    const batchAttDoc = await db.collection('attendance').doc(batchAttDocId).get();
    assert.equal(batchAttDoc.exists, false, 'Batch attendance must be pruned when batch is migrated');

    const otherAttDoc = await db.collection('attendance').doc(otherAttDocId).get();
    assert.equal(otherAttDoc.exists, true, 'Attendance for another batch must NOT be deleted');

    // Verify student payments and test submissions are pruned
    const payDoc = await db.collection('fee_payments').doc(studentPaymentId).get();
    assert.equal(payDoc.exists, false, 'Student fee payments must be pruned from Firestore');

    const subDoc = await db.collection('test_submissions').doc(studentSubId).get();
    assert.equal(subDoc.exists, false, 'Student test submissions must be pruned from Firestore');
  });

  // 9. Rollback is permanently disabled to preserve Firestore storage reduction
  await t.test('9. POST /api/archive/rollback/:migrationId is rejected because operational records were pruned from Firestore', async () => {
    assert.ok(executedMigrationId, 'Must have migration ID to test rollback attempt');
    const res = await fetch(`${baseUrl}/api/archive/rollback/${executedMigrationId}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer mock_admin_master' },
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.error.includes('Rollback is permanently disabled'));

    // Verify operational records were pruned from Firestore to reduce storage
    const prunedFee = await db.collection('fee_accounts').doc(`fee_${testStudentUid}`).get();
    assert.equal(prunedFee.exists, false);

    const prunedEnrollment = await db.collection('enrollments').doc(`enr_${testStudentUid}`).get();
    assert.equal(prunedEnrollment.exists, false);
  });

  // Cleanup test fixtures
  await t.test('10. Clean up test fixtures from Firestore and MongoDB', async () => {
    await db.collection('students').doc(testStudentUid).delete();
    await db.collection('batches').doc(testBatchId).delete();
    await db.collection('fee_accounts').doc(`fee_${testStudentUid}`).delete();
    await db.collection('enrollments').doc(`enr_${testStudentUid}`).delete();
    await db.collection('tests').doc(allBatchesTestId).delete();
    await db.collection('tests').doc(otherBatchTestId).delete();
    await db.collection('attendance').doc(otherAttDocId).delete();
    await ArchivedStudent.deleteMany({ studentUid: testStudentUid });
    await ArchivedBatch.deleteMany({ batchId: testBatchId });
    await MigrationAuditLog.deleteMany({ targetId: { $in: [testStudentUid, testBatchId] } });
  });
});
