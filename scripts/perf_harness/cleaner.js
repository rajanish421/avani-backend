const fs = require('fs');
const { auth, db } = require('../../src/config/firebase');
const { getDatabase } = require('firebase-admin/database');
const { TEST_PREFIX, MANIFEST_FILE } = require('./config');

async function cleanSyntheticData() {
  console.log('====================================================');
  console.log('   Avani Computer Institute - Test Data Cleanup     ');
  console.log('====================================================\n');

  let manifest = { courses: [], batches: [], studyMaterials: [], tests: [], admin: null, students: [] };
  if (fs.existsSync(MANIFEST_FILE)) {
    try {
      manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    } catch (_) {}
  }

  // 1. Clean synthetic Courses
  console.log('⏳ Cleaning synthetic Courses...');
  const coursesSnap = await db.collection('courses').get();
  let deletedCourses = 0;
  for (const doc of coursesSnap.docs) {
    if (doc.id.startsWith(TEST_PREFIX) || doc.data().isSynthetic) {
      await doc.ref.delete();
      deletedCourses++;
    }
  }
  console.log(`✔ Deleted ${deletedCourses} synthetic courses.`);

  // 2. Clean synthetic Batches
  console.log('⏳ Cleaning synthetic Batches...');
  const batchesSnap = await db.collection('batches').get();
  let deletedBatches = 0;
  for (const doc of batchesSnap.docs) {
    if (doc.id.startsWith(TEST_PREFIX) || doc.data().isSynthetic) {
      await doc.ref.delete();
      deletedBatches++;
    }
  }
  console.log(`✔ Deleted ${deletedBatches} synthetic batches.`);

  // 3. Clean synthetic Study Materials
  console.log('⏳ Cleaning synthetic Study Materials...');
  const matsSnap = await db.collection('study_materials').get();
  let deletedMats = 0;
  for (const doc of matsSnap.docs) {
    if (doc.id.startsWith(TEST_PREFIX) || doc.data().isSynthetic) {
      await doc.ref.delete();
      deletedMats++;
    }
  }
  console.log(`✔ Deleted ${deletedMats} synthetic study materials.`);

  // 4. Clean synthetic Tests
  console.log('⏳ Cleaning synthetic CBT Tests...');
  const testsSnap = await db.collection('tests').get();
  let deletedTests = 0;
  for (const doc of testsSnap.docs) {
    if (doc.id.startsWith(TEST_PREFIX) || doc.data().isSynthetic) {
      await doc.ref.delete();
      deletedTests++;
    }
  }
  console.log(`✔ Deleted ${deletedTests} synthetic tests.`);

  // 5. Clean synthetic Test Submissions
  console.log('⏳ Cleaning synthetic Test Submissions...');
  const subsSnap = await db.collection('test_submissions').get();
  let deletedSubs = 0;
  for (const doc of subsSnap.docs) {
    if (doc.id.startsWith(TEST_PREFIX) || doc.data().isSynthetic) {
      await doc.ref.delete();
      deletedSubs++;
    }
  }
  console.log(`✔ Deleted ${deletedSubs} synthetic test submissions.`);

  // 6. Clean synthetic QR tokens & Fee Payments
  console.log('⏳ Cleaning synthetic QR Tokens & Payments...');
  const qrSnap = await db.collection('qr_tokens').get();
  for (const doc of qrSnap.docs) {
    if (doc.id.startsWith('QR_') || doc.data().isSynthetic) {
      await doc.ref.delete();
    }
  }
  const paySnap = await db.collection('fee_payments').get();
  for (const doc of paySnap.docs) {
    if (doc.id.startsWith('PAY_') || doc.data().isSynthetic) {
      await doc.ref.delete();
    }
  }

  // 7. Clean synthetic Students & Fee Accounts
  console.log('⏳ Cleaning synthetic Students & Fee Accounts...');
  const studentsSnap = await db.collection('students').get();
  let deletedStudents = 0;
  for (const doc of studentsSnap.docs) {
    const data = doc.data();
    const isSyntheticStudent =
      doc.id.startsWith(TEST_PREFIX) ||
      data.isSynthetic ||
      (data.email && data.email.endsWith('@test.students.avani.internal')) ||
      (data.internalEmail && data.internalEmail.endsWith('@test.students.avani.internal'));

    if (isSyntheticStudent) {
      // Delete subcollection attendance_records
      const attSnap = await doc.ref.collection('attendance_records').get();
      for (const attDoc of attSnap.docs) {
        await attDoc.ref.delete();
      }
      // Delete subcollection test_submissions
      const tSubSnap = await doc.ref.collection('test_submissions').get();
      for (const tDoc of tSubSnap.docs) {
        await tDoc.ref.delete();
      }
      // Delete student document
      await doc.ref.delete();
      deletedStudents++;

      // Delete corresponding fee account
      try {
        await db.collection('fee_accounts').doc(`fee_${doc.id}`).delete();
      } catch (_) {}
    }
  }
  console.log(`✔ Deleted ${deletedStudents} synthetic students & fee accounts.`);

  // 8. Clean Student ID Lookup
  const lookupSnap = await db.collection('student_id_lookup').get();
  for (const doc of lookupSnap.docs) {
    if (doc.id.startsWith('PERF-') || doc.data().isSynthetic) {
      await doc.ref.delete();
    }
  }

  // 9. Clean synthetic Admin Firestore doc
  if (manifest.admin?.uid) {
    try {
      await db.collection('admins').doc(manifest.admin.uid).delete();
      console.log(`✔ Deleted synthetic admin record from Firestore.`);
    } catch (_) {}
  }

  // 10. Clean RTDB Live Exams
  try {
    const { getDatabase } = require('firebase-admin/database');
    const { initializeApp, getApps, deleteApp } = require('firebase-admin/app');
    let rtdbApp = getApps().find((a) => a.name === 'cleaner_rtdb_app');
    if (!rtdbApp) {
      rtdbApp = initializeApp({
        projectId: 'avani-computer-institute-44b7f',
        databaseURL: 'https://avani-computer-institute-44b7f-default-rtdb.firebaseio.com',
      }, 'cleaner_rtdb_app');
    }
    const adminRtdb = getDatabase(rtdbApp);
    await adminRtdb.ref(`live_exams/${TEST_PREFIX}exam_cbt_1`).remove();
    console.log(`✔ Cleaned RTDB live exam path: live_exams/${TEST_PREFIX}exam_cbt_1`);
    await deleteApp(rtdbApp);
  } catch (err) {
    console.warn(`   RTDB cleanup notice: ${err.message}`);
  }

  // 11. Delete synthetic Auth Users
  console.log('⏳ Deleting synthetic Firebase Auth accounts...');
  let totalAuthDeleted = 0;

  // From manifest
  const uidsToDelete = new Set();
  if (manifest.admin?.uid) uidsToDelete.add(manifest.admin.uid);
  if (manifest.students) {
    manifest.students.forEach((s) => s.uid && uidsToDelete.add(s.uid));
  }

  for (const uid of uidsToDelete) {
    try {
      await auth.deleteUser(uid);
      totalAuthDeleted++;
    } catch (_) {}
  }

  // Sweep remaining @test.students.avani.internal accounts
  let pageToken;
  do {
    const listResult = await auth.listUsers(100, pageToken);
    for (const user of listResult.users) {
      if (user.email && user.email.endsWith('@test.students.avani.internal')) {
        try {
          await auth.deleteUser(user.uid);
          totalAuthDeleted++;
        } catch (_) {}
      }
    }
    pageToken = listResult.pageToken;
  } while (pageToken);

  console.log(`✔ Deleted ${totalAuthDeleted} synthetic Auth accounts.`);

  // Clean manifest file
  if (fs.existsSync(MANIFEST_FILE)) {
    fs.unlinkSync(MANIFEST_FILE);
  }

  console.log('\n====================================================');
  console.log('🎉 Teardown complete! All synthetic test data safely purged.');
  console.log('   All production data preserved intact.');
  console.log('====================================================');
}

if (require.main === module) {
  cleanSyntheticData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Error during cleanup:', err);
      process.exit(1);
    });
}

module.exports = { cleanSyntheticData };
