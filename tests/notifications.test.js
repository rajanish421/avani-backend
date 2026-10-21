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

test('FCM and Notification System Suite', async (t) => {
  const dummyUid = `test_std_${crypto.randomUUID().slice(0, 8)}`;
  const dummyToken = `fcm_token_${crypto.randomUUID()}`;

  // Seed student in Firestore for tests
  test.before(async () => {
    try {
      await db.collection('students').doc(dummyUid).set({
        id: dummyUid,
        name: 'Aarav Patel',
        batchId: 'batch_adca_morn',
        batch: 'ADCA Morning',
        course: 'ADCA',
        courseId: 'course_adca',
        status: 'Active',
      });
    } catch (_) {}
  });

  test.after(async () => {
    try {
      await db.collection('students').doc(dummyUid).delete();
    } catch (_) {}
  });

  await t.test('1. POST /api/notifications/save-token saves student FCM device token', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/save-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentUid: dummyUid,
        token: dummyToken,
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.tokenSaved, true);

    // Verify in Firestore
    const studentDoc = await db.collection('students').doc(dummyUid).get();
    assert.equal(studentDoc.data().fcmToken, dummyToken);
  });

  await t.test('2. POST /api/notifications/fee-due sends notification when fee is due for specific student', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/fee-due`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentUid: dummyUid,
        studentName: 'Aarav Patel',
        amount: 2500,
        dueDate: '25 Oct 2026',
        courseName: 'ADCA',
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.notificationId);
    assert.ok(data.title.includes('Fee Payment Due'));
    assert.ok(data.body.includes('₹2,500'));

    // Verify persisted in Firestore /notifications
    const notifDoc = await db.collection('notifications').doc(data.notificationId).get();
    assert.equal(notifDoc.exists, true);
    assert.equal(notifDoc.data().type, 'fee_due');
    assert.equal(notifDoc.data().studentUid, dummyUid);
  });

  await t.test('3. POST /api/notifications/fee-reminder sends admin fee reminder to specific student', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/fee-reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentUid: dummyUid,
        studentName: 'Aarav Patel',
        amount: 3000,
        courseName: 'ADCA',
        customNote: 'Please clear your 2nd installment before next Monday.',
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.notificationId);
    assert.equal(data.body, 'Please clear your 2nd installment before next Monday.');
  });

  await t.test('4. POST /api/notifications/test sends live and upcoming exam push notifications', async () => {
    // 4a: Upcoming Test to Batch
    const resUpcoming = await fetch(`${baseUrl}/api/notifications/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testId: 'test_cbt_01',
        testTitle: 'CBT Term Exam 1',
        subject: 'C Programming',
        date: '28 Oct 2026',
        time: '10:00 AM',
        totalMarks: 50,
        targetType: 'Specific Batch',
        targetBatchId: 'batch_adca_morn',
        isLive: false,
      }),
    });

    const dataUpcoming = await resUpcoming.json();
    assert.equal(resUpcoming.status, 200);
    assert.equal(dataUpcoming.success, true);
    assert.equal(dataUpcoming.targetTopic, 'batch_batch_adca_morn');
    assert.ok(dataUpcoming.title.includes('Upcoming Exam'));

    // 4b: Live Exam to All Students
    const resLive = await fetch(`${baseUrl}/api/notifications/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testId: 'test_cbt_all',
        testTitle: 'All Institute Speed Typing Contest',
        subject: 'Computer Practical',
        targetType: 'All Students',
        isLive: true,
      }),
    });

    const dataLive = await resLive.json();
    assert.equal(resLive.status, 200);
    assert.equal(dataLive.success, true);
    assert.equal(dataLive.targetTopic, 'all_students');
    assert.ok(dataLive.title.includes('Exam is Now LIVE'));
  });

  await t.test('5. POST /api/notifications/class-rescheduled sends reschedule alert to specific batch', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/class-rescheduled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batchId: 'batch_adca_morn',
        batchName: 'ADCA Morning Batch',
        subject: 'Web Development',
        date: '20 Oct 2026',
        originalTime: '09:00 AM',
        newTime: '01:00 PM',
        isCancelled: false,
        reason: 'Lab hardware upgrade',
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.targetTopic, 'batch_batch_adca_morn');
    assert.ok(data.title.includes('Class Rescheduled'));
    assert.ok(data.body.includes('01:00 PM'));
  });

  await t.test('6. POST /api/notifications/festival-wish broadcasts festival wish to all students', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/festival-wish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '✨ Happy Diwali to All Students!',
        message: 'May this festival of lights illuminate your learning journey with prosperity and success!',
        festivalName: 'Diwali',
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.targetTopic, 'all_students');
    assert.ok(data.title.includes('Happy Diwali'));
  });

  await t.test('7. GET /api/notifications/student/:studentUid fetches in-app notifications for student', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/student/${dummyUid}`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.count > 0);
    assert.ok(Array.isArray(data.notifications));

    // Verify first notification can be marked as read
    const firstNotifId = data.notifications[0].id;
    const markRes = await fetch(`${baseUrl}/api/notifications/${firstNotifId}/mark-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentUid: dummyUid }),
    });

    const markData = await markRes.json();
    assert.equal(markRes.status, 200);
    assert.equal(markData.success, true);
  });

  await t.test('8. POST /api/notifications/payment-verification sends verification notification when admin approves payment', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/payment-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentUid: dummyUid,
        studentName: 'Aarav Patel',
        amount: 2500,
        transactionId: 'UPI-9876543210',
        isApproved: true,
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.notificationId);
    assert.ok(data.title.includes('Payment Approved'));
    assert.ok(data.body.includes('UPI-9876543210'));

    // Check Firestore doc
    const notifDoc = await db.collection('notifications').doc(data.notificationId).get();
    assert.equal(notifDoc.exists, true);
    assert.equal(notifDoc.data().type, 'payment_verified');
    assert.equal(notifDoc.data().studentUid, dummyUid);
  });

  await t.test('9. POST /api/notifications/low-attendance sends low attendance alert when attendance drops below 75%', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/low-attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentUid: dummyUid,
        studentName: 'Aarav Patel',
        attendancePct: 60,
        conducted: 10,
        attended: 6,
        batchName: 'ADCA Morning',
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.notificationId);
    assert.ok(data.title.includes('Low Attendance Warning'));
    assert.ok(data.body.includes('60%'));
    assert.ok(data.body.includes('6/10'));

    // Check Firestore doc
    const notifDoc = await db.collection('notifications').doc(data.notificationId).get();
    assert.equal(notifDoc.exists, true);
    assert.equal(notifDoc.data().type, 'low_attendance');
    assert.equal(notifDoc.data().studentUid, dummyUid);
  });

  await t.test('10. POST /api/notifications/announcement sends conditional announcement notifications', async () => {
    // 10a: Batch specific announcement
    const resBatch = await fetch(`${baseUrl}/api/notifications/announcement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Project Submission Deadline',
        message: 'All Batch A students must submit project work by Friday.',
        category: 'General',
        targetType: 'Specific Batch',
        targetBatchId: 'batch_adca_morn',
        targetBatchName: 'ADCA Morning',
      }),
    });

    const dataBatch = await resBatch.json();
    assert.equal(resBatch.status, 200);
    assert.equal(dataBatch.success, true);
    assert.ok(dataBatch.notificationId);

    const batchDoc = await db.collection('notifications').doc(dataBatch.notificationId).get();
    assert.equal(batchDoc.exists, true);
    assert.equal(batchDoc.data().targetType, 'Specific Batch');
    assert.equal(batchDoc.data().targetBatchId, 'batch_adca_morn');
    assert.equal(batchDoc.data().targetBatchName, 'ADCA Morning');

    // 10b: Student specific announcement
    const resStudent = await fetch(`${baseUrl}/api/notifications/announcement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Special Certificate Available',
        message: 'Your certificate is ready for pickup.',
        category: 'General',
        targetType: 'Specific Student',
        studentUid: dummyUid,
      }),
    });

    const dataStudent = await resStudent.json();
    assert.equal(resStudent.status, 200);
    assert.equal(dataStudent.success, true);
    assert.ok(dataStudent.notificationId);

    const studentDoc = await db.collection('notifications').doc(dataStudent.notificationId).get();
    assert.equal(studentDoc.exists, true);
    assert.equal(studentDoc.data().targetType, 'Specific Student');
    assert.equal(studentDoc.data().studentUid, dummyUid);
  });

  await t.test('11. POST /api/notifications/cleanup-expired purges notifications older than 30 days while preserving recent ones', async () => {
    // Seed an expired notification (35 days old)
    const expiredDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const expiredRef = db.collection('notifications').doc();
    await expiredRef.set({
      id: expiredRef.id,
      title: 'Old Notification from 35 Days Ago',
      message: 'This should be automatically deleted.',
      type: 'general',
      createdAt: expiredDate,
    });

    // Seed a recent notification (5 days old)
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const recentRef = db.collection('notifications').doc();
    await recentRef.set({
      id: recentRef.id,
      title: 'Recent Notification from 5 Days Ago',
      message: 'This should be preserved.',
      type: 'general',
      createdAt: recentDate,
    });

    // Call cleanup endpoint with days: 30
    const res = await fetch(`${baseUrl}/api/notifications/cleanup-expired`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 30 }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.deletedCount >= 1);

    // Verify expired doc was deleted
    const expiredCheck = await expiredRef.get();
    assert.equal(expiredCheck.exists, false, 'Expired notification must be deleted');

    // Verify recent doc was kept
    const recentCheck = await recentRef.get();
    assert.equal(recentCheck.exists, true, 'Recent notification must be preserved');

    // Clean up test recent doc
    await recentRef.delete();
  });

  await t.test('12. POST /api/notifications/birthday-wish sends personalized birthday wish strictly to student', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/birthday-wish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentUid: dummyUid,
        studentName: 'Aarav Patel',
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.notificationId);
    assert.ok(data.title.includes('Happy Birthday, Aarav Patel!'));

    // Verify stored in Firestore /notifications strictly for this student
    const notifDoc = await db.collection('notifications').doc(data.notificationId).get();
    assert.equal(notifDoc.exists, true);
    assert.equal(notifDoc.data().type, 'birthday_wish');
    assert.equal(notifDoc.data().targetType, 'Specific Student');
    assert.equal(notifDoc.data().studentUid, dummyUid);

    // Clean up
    await db.collection('notifications').doc(data.notificationId).delete();
  });

  await t.test('13. POST /api/notifications/trigger-daily-greetings sends festival wish to all + admin, and birthday wish to celebrant', async () => {
    // Set student's dob to match test date (e.g. 15 August 2004)
    await db.collection('students').doc(dummyUid).set(
      {
        dob: '2004-08-15',
      },
      { merge: true }
    );

    // Trigger daily greetings for 2026-08-15 (Independence Day + Aarav's Birthday)
    const res = await fetch(`${baseUrl}/api/notifications/trigger-daily-greetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: '2026-08-15T09:00:00+05:30',
        force: true,
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);

    // Festival check: Independence Day
    assert.ok(data.festival);
    assert.equal(data.festival.sent, true);
    assert.equal(data.festival.festivalName, 'Independence Day');

    // Birthday check: Aarav Patel is greeted
    assert.ok(data.birthdays.length >= 1);
    const aaravBirthday = data.birthdays.find((b) => b.studentUid === dummyUid);
    assert.ok(aaravBirthday, 'Aarav Patel should receive birthday greeting');
    assert.equal(aaravBirthday.sent, true);

    // Verify admin_notifications received festival wish
    const adminNotifSnap = await db
      .collection('admin_notifications')
      .where('type', '==', 'festival_wish')
      .limit(5)
      .get();
    assert.equal(adminNotifSnap.empty, false, 'Admin must receive festival greeting');
    assert.ok(adminNotifSnap.docs[0].data().title.includes('Independence Day'));

    // Clean up test created notifications
    if (data.festival.notificationId) {
      await db.collection('notifications').doc(data.festival.notificationId).delete();
    }
    if (aaravBirthday.notificationId) {
      await db.collection('notifications').doc(aaravBirthday.notificationId).delete();
    }
    if (!adminNotifSnap.empty) {
      await adminNotifSnap.docs[0].ref.delete();
    }
  });
});
