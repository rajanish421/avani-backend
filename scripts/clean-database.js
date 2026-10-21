const { auth, db } = require('../src/config/firebase');

async function deleteCollection(collectionPath, batchSize = 100) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve, reject);
  });
}

async function deleteQueryBatch(query, resolve, reject) {
  try {
    const snapshot = await query.get();
    const batchSize = snapshot.size;
    if (batchSize === 0) {
      resolve();
      return;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    process.nextTick(() => {
      deleteQueryBatch(query, resolve, reject);
    });
  } catch (err) {
    reject(err);
  }
}

async function cleanData({ keepAdminEmail = null } = {}) {
  console.log('====================================================');
  console.log('   Avani Computer Institute - Data Clean Utility    ');
  console.log('====================================================\n');

  console.log('⏳ 1. Cleaning all Firestore collections...');
  const collections = await db.listCollections();
  for (const col of collections) {
    console.log(`   Deleting collection: ${col.id}...`);
    await deleteCollection(col.id);
  }
  console.log('✔ All Firestore collections cleared successfully.');

  console.log('\n⏳ 2. Cleaning Firebase Auth users...');
  let totalDeleted = 0;
  let pageToken;
  do {
    const listResult = await auth.listUsers(100, pageToken);
    for (const user of listResult.users) {
      if (keepAdminEmail && user.email && user.email.toLowerCase() === keepAdminEmail.toLowerCase()) {
        console.log(`   Keeping Admin user: ${user.email} (UID: ${user.uid})`);
        // Re-seed their Firestore admin record so they can immediately sign in!
        await db.collection('admins').doc(user.uid).set({
          uid: user.uid,
          userId: user.uid,
          email: user.email,
          name: user.displayName || 'Administrator',
          role: 'admin',
          isActive: true,
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        await auth.setCustomUserClaims(user.uid, { role: 'admin', admin: true });
        console.log(`   ✔ Restored admin record in Firestore for ${user.email}`);
        continue;
      }
      await auth.deleteUser(user.uid);
      totalDeleted++;
      console.log(`   Deleted user: ${user.email || user.uid}`);
    }
    pageToken = listResult.pageToken;
  } while (pageToken);

  console.log(`✔ Auth cleanup complete. Deleted ${totalDeleted} users.`);
  console.log('\n====================================================');
  console.log('🎉 Reset complete! The database is 100% clean and ready for testing.');
  console.log('====================================================');
}

// Check CLI arguments: --keep-admin=<email> or --all
const keepAdminArg = process.argv.find((a) => a.startsWith('--keep-admin='));
const keepAdminEmail = keepAdminArg ? keepAdminArg.split('=')[1] : null;

cleanData({ keepAdminEmail })
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Error during cleanup:', e);
    process.exit(1);
  });
