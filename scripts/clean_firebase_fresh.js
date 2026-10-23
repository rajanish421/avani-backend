const { auth, db } = require('../src/config/firebase');

/**
 * Script to clean Firebase test data for fresh client handover.
 *
 * Mode 'smart' (default):
 * - Purges all student accounts from Firebase Auth (retaining admin accounts)
 * - Purges test collections (students, enrollments, fees, submissions, notifications, etc.)
 * - Resets student registration counter to 0 (next student will be ACI00001)
 * - Resets batch enrolled count to 0
 * - Preserves admin account, courses, batches, and study material templates.
 *
 * Mode 'full':
 * - Also purges courses, batches, study materials, certificates, tests (retaining only admin).
 */

async function cleanData(mode = 'smart') {
  console.log(`\n======================================================`);
  console.log(`  STARTING FIREBASE DATABASE CLEANUP (Mode: ${mode})   `);
  console.log(`======================================================\n`);

  // 1. Firebase Auth Cleanup
  console.log('[1/4] Scanning Firebase Auth users...');
  let pageToken;
  let deletedAuthUsersCount = 0;
  let preservedAdminsCount = 0;

  do {
    const listResult = await auth.listUsers(1000, pageToken);
    pageToken = listResult.pageToken;

    for (const user of listResult.users) {
      const isStudent = user.email && user.email.endsWith('@students.avani.internal');
      const isAdmin = user.email && (user.email === 'rajanishsingh729@gmail.com' || user.email.includes('admin'));

      if (isStudent || (!isAdmin && mode === 'full')) {
        await auth.deleteUser(user.uid);
        deletedAuthUsersCount++;
      } else {
        console.log(`  [PRESERVED ADMIN] UID: ${user.uid} | Email: ${user.email}`);
        preservedAdminsCount++;
      }
    }
  } while (pageToken);

  console.log(`✔ Auth cleanup complete. Deleted ${deletedAuthUsersCount} test users. Preserved ${preservedAdminsCount} admin user(s).\n`);

  // 2. Collections to delete
  const studentCollections = [
    'students',
    'enrollments',
    'fee_accounts',
    'fee_payments',
    'fee_reminders',
    'payment_submissions',
    'registration_requests',
    'student_id_lookup',
    'qr_tokens',
    'notifications',
    'admin_notifications',
    'daily_greetings_log',
    'test_submissions',
  ];

  const masterCollections = [
    'courses',
    'batches',
    'study_materials',
    'certificates',
    'tests',
    'announcements',
  ];

  const targetCollections = mode === 'full' 
    ? [...studentCollections, ...masterCollections]
    : studentCollections;

  console.log(`[2/4] Purging ${targetCollections.length} Firestore collections...`);
  for (const colName of targetCollections) {
    const snap = await db.collection(colName).get();
    if (snap.empty) {
      console.log(`  - ${colName}: already empty`);
      continue;
    }
    const batchSize = 400;
    let batch = db.batch();
    let count = 0;
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      count++;
      if (count % batchSize === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    await batch.commit();
    console.log(`  ✔ ${colName}: purged ${count} document(s)`);
  }

  // 3. Reset system counter to 0 so fresh registration starts at ACI00001
  console.log('\n[3/4] Resetting student registration sequence counter to 0...');
  await db.collection('system_counters').doc('student_registration').set({
    lastSequence: 0,
    prefix: 'ACI',
    padding: 5,
    resetAt: new Date().toISOString(),
  });
  console.log('✔ Sequence counter reset. First new registered student will receive ID: ACI00001.');

  // 4. If mode is smart, reset batch enrollment counts
  if (mode === 'smart') {
    console.log('\n[4/4] Resetting batch enrolled counts to 0...');
    const batchesSnap = await db.collection('batches').get();
    for (const doc of batchesSnap.docs) {
      await doc.ref.update({
        enrolled: 0,
        assignedStudentIds: [],
        scheduleExceptions: [],
      });
      console.log(`  ✔ Batch ${doc.id} (${doc.data().name}): enrolled count reset to 0`);
    }
  }

  console.log(`\n======================================================`);
  console.log(`  FIREBASE DATABASE IS NOW CLEAN & PRODUCTION FRESH!   `);
  console.log(`======================================================\n`);
}

module.exports = { cleanData };

if (require.main === module) {
  const mode = process.argv[2] || 'smart';
  cleanData(mode).then(() => process.exit(0)).catch(err => {
    console.error('Error cleaning Firebase data:', err);
    process.exit(1);
  });
}
