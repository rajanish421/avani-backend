const readline = require('readline');
const { auth, db } = require('../src/config/firebase');

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

async function main() {
  console.log('====================================================');
  console.log('   Avani Computer Institute - Admin Setup Utility   ');
  console.log('====================================================\n');

  let email = process.argv[2];
  let password = process.argv[3];
  let name = process.argv[4];

  if (!email) {
    email = await askQuestion('Enter Admin Email: ');
  }
  if (!password) {
    password = await askQuestion('Enter Admin Password (min 6 chars): ');
  }
  if (!name) {
    name = await askQuestion('Enter Admin Full Name [Administrator]: ');
    if (!name) name = 'Administrator';
  }

  if (!email || !email.includes('@')) {
    console.error('❌ Error: A valid email address is required.');
    process.exit(1);
  }

  if (!password || password.length < 6) {
    console.error('❌ Error: Password must be at least 6 characters.');
    process.exit(1);
  }

  email = email.toLowerCase().trim();
  console.log(`\n⏳ Provisioning Admin account for: ${email}...`);

  try {
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
      console.log(`ℹ️ User already exists in Firebase Auth (UID: ${userRecord.uid}). Updating password and display name...`);
      userRecord = await auth.updateUser(userRecord.uid, {
        password: password,
        displayName: name,
      });
    } catch (notFoundErr) {
      if (notFoundErr.code === 'auth/user-not-found') {
        userRecord = await auth.createUser({
          email: email,
          password: password,
          displayName: name,
        });
        console.log(`✔ Created new Firebase Auth user (UID: ${userRecord.uid})`);
      } else {
        throw notFoundErr;
      }
    }

    // Set custom user claims
    await auth.setCustomUserClaims(userRecord.uid, {
      role: 'admin',
      admin: true,
    });
    console.log(`✔ Set custom user claims { role: 'admin', admin: true }`);

    // Create or update Firestore admins collection document
    const nowIso = new Date().toISOString();
    await db.collection('admins').doc(userRecord.uid).set({
      uid: userRecord.uid,
      userId: userRecord.uid,
      email: email,
      name: name,
      role: 'admin',
      isActive: true,
      active: true,
      updatedAt: nowIso,
    }, { merge: true });

    console.log(`✔ Saved admin record in Firestore: admins/${userRecord.uid}`);
    console.log('\n====================================================');
    console.log('🎉 Admin account setup complete successfully!');
    console.log(`   Email: ${email}`);
    console.log(`   UID:   ${userRecord.uid}`);
    console.log(`   Role:  admin`);
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to provision admin account:', err.message);
    process.exit(1);
  }
}

main();
