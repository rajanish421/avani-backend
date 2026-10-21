const fs = require('fs');
const path = require('path');
const { auth, db, FieldValue } = require('../../src/config/firebase');
const { TEST_PREFIX, MANIFEST_FILE } = require('./config');

const COURSES_LIST = [
  { code: 'DCA', name: 'Diploma in Computer Applications', duration: '6 Months', fee: 12000 },
  { code: 'ADCA', name: 'Advanced Diploma in Computer Applications', duration: '12 Months', fee: 18000 },
  { code: 'CCC', name: 'Course on Computer Concepts', duration: '3 Months', fee: 5000 },
  { code: 'PGDCA', name: 'Post Graduate Diploma in Computer Applications', duration: '12 Months', fee: 22000 },
  { code: 'TALLY', name: 'TallyPrime with GST & Taxation', duration: '3 Months', fee: 8000 },
  { code: 'WEBDEV', name: 'Full Stack Web Development (React & Node)', duration: '6 Months', fee: 25000 },
  { code: 'PY_AI', name: 'Python Programming with AI & ML Basics', duration: '4 Months', fee: 20000 },
  { code: 'GRAPHIC', name: 'Graphic Design & Digital Publishing', duration: '4 Months', fee: 15000 },
  { code: 'HW_NET', name: 'Computer Hardware & Network Engineering', duration: '6 Months', fee: 16000 },
  { code: 'CYBER', name: 'Cyber Security & Ethical Hacking Basics', duration: '4 Months', fee: 24000 },
  { code: 'JAVA', name: 'Core & Advanced Java Enterprise', duration: '6 Months', fee: 20000 },
  { code: 'DATA', name: 'Data Analytics with PowerBI & Advanced Excel', duration: '3 Months', fee: 14000 },
  { code: 'ENGLISH', name: 'Spoken English & Professional Personality', duration: '3 Months', fee: 6000 },
  { code: 'MOBILE', name: 'Cross-Platform Mobile App Dev (Flutter)', duration: '5 Months', fee: 22000 },
  { code: 'OFFICE', name: 'Office Automation & Desktop Publishing', duration: '3 Months', fee: 7000 },
];

async function retryWithBackoff(fn, maxRetries = 4, baseDelay = 300) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const isNet =
        err.code === 'app/network-error' ||
        err.message?.includes('ENETUNREACH') ||
        err.message?.includes('fetch failed');
      const waitTime = isNet ? baseDelay * attempt * 2 : baseDelay * attempt;
      await new Promise((r) => setTimeout(r, waitTime));
    }
  }
}

class SafeSeeder {
  constructor() {
    this.manifest = this._loadManifest();
  }

  _loadManifest() {
    if (fs.existsSync(MANIFEST_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
      } catch (_) {}
    }
    return {
      courses: [],
      batches: [],
      studyMaterials: [],
      tests: [],
      admin: null,
      students: [],
    };
  }

  _saveManifest() {
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(this.manifest, null, 2));
  }

  async seedBaseTopology() {
    console.log('⏳ Seeding Base Institute Topology (15 Courses, 30 Batches, Live CBT Exam)...');
    const nowIso = new Date().toISOString();

    // 1. Seed 15 Courses
    const courseBatch = db.batch();
    for (let i = 0; i < COURSES_LIST.length; i++) {
      const c = COURSES_LIST[i];
      const courseId = `${TEST_PREFIX}course_${(i + 1).toString().padStart(2, '0')}`;
      const docRef = db.collection('courses').doc(courseId);
      courseBatch.set(docRef, {
        id: courseId,
        name: c.name,
        code: c.code,
        duration: c.duration,
        fee: c.fee,
        totalFees: c.fee,
        status: 'Active',
        isActive: true,
        isSynthetic: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      if (!this.manifest.courses.includes(courseId)) {
        this.manifest.courses.push(courseId);
      }
    }
    await courseBatch.commit();
    console.log(`✔ Seeded 15 courses into Firestore`);

    // 2. Seed 30 Batches (2 per course)
    const batchBatch = db.batch();
    let batchIndex = 1;
    for (let i = 0; i < COURSES_LIST.length; i++) {
      const c = COURSES_LIST[i];
      const courseId = `${TEST_PREFIX}course_${(i + 1).toString().padStart(2, '0')}`;

      // Morning Batch A
      const batchAId = `${TEST_PREFIX}batch_${batchIndex.toString().padStart(2, '0')}_m`;
      batchBatch.set(db.collection('batches').doc(batchAId), {
        id: batchAId,
        code: `${c.code}-M1`,
        name: `${c.name} - Morning Batch A`,
        courseName: c.name,
        courseId: courseId,
        timeSlot: '08:00 AM - 10:00 AM',
        room: 'Lab 1',
        labRoom: 'Lab 1',
        trainer: 'Prof. A. Sharma',
        instructor: 'Prof. A. Sharma',
        days: 'Mon - Sat',
        status: 'Active',
        isActive: true,
        isSynthetic: true,
        assignedStudentIds: [],
        createdAt: nowIso,
      });
      if (!this.manifest.batches.includes(batchAId)) this.manifest.batches.push(batchAId);
      batchIndex++;

      // Evening Batch B
      const batchBId = `${TEST_PREFIX}batch_${batchIndex.toString().padStart(2, '0')}_e`;
      batchBatch.set(db.collection('batches').doc(batchBId), {
        id: batchBId,
        code: `${c.code}-E1`,
        name: `${c.name} - Evening Batch B`,
        courseName: c.name,
        courseId: courseId,
        timeSlot: '04:00 PM - 06:00 PM',
        room: 'Lab 2',
        labRoom: 'Lab 2',
        trainer: 'Prof. R. Verma',
        instructor: 'Prof. R. Verma',
        days: 'Mon - Sat',
        status: 'Active',
        isActive: true,
        isSynthetic: true,
        assignedStudentIds: [],
        createdAt: nowIso,
      });
      if (!this.manifest.batches.includes(batchBId)) this.manifest.batches.push(batchBId);
      batchIndex++;
    }
    await batchBatch.commit();
    console.log(`✔ Seeded 30 batches into Firestore`);

    // 3. Seed Study Materials
    const matBatch = db.batch();
    for (let i = 1; i <= 5; i++) {
      const matId = `${TEST_PREFIX}mat_${i}`;
      matBatch.set(db.collection('study_materials').doc(matId), {
        id: matId,
        title: `Comprehensive Lecture Notes Unit ${i}`,
        description: `Foundation lecture slides and practice exercises for Unit ${i}`,
        courseId: 'All Courses',
        batchId: 'All Batches',
        fileUrl: 'https://res.cloudinary.com/demo/image/upload/sample.pdf',
        fileType: 'pdf',
        isSynthetic: true,
        createdAt: nowIso,
      });
      if (!this.manifest.studyMaterials.includes(matId)) this.manifest.studyMaterials.push(matId);
    }
    await matBatch.commit();
    console.log(`✔ Seeded 5 study materials into Firestore`);

    // 4. Seed Live CBT Examination
    const testId = `${TEST_PREFIX}exam_cbt_1`;
    const questions = [
      { id: 'q1', text: 'What is the full form of CPU?', options: ['Central Processing Unit', 'Central Program Utility', 'Computer Personal Unit', 'Control Processing Unit'], correctOptionIndex: 0, marks: 5 },
      { id: 'q2', text: 'Which shortcut key is used to save a document in MS Office?', options: ['Ctrl + P', 'Ctrl + S', 'Ctrl + O', 'Ctrl + V'], correctOptionIndex: 1, marks: 5 },
      { id: 'q3', text: 'RAM stands for:', options: ['Read Access Memory', 'Random Access Memory', 'Run Active Memory', 'Remote Access Memory'], correctOptionIndex: 1, marks: 5 },
      { id: 'q4', text: 'Which protocol is used for secure browsing on the web?', options: ['HTTP', 'FTP', 'HTTPS', 'SMTP'], correctOptionIndex: 2, marks: 5 },
      { id: 'q5', text: 'In Python, which keyword is used to define a function?', options: ['func', 'def', 'function', 'define'], correctOptionIndex: 1, marks: 5 },
      { id: 'q6', text: 'What is the brain of the computer system?', options: ['ALU', 'Memory', 'CPU', 'Hard Disk'], correctOptionIndex: 2, marks: 5 },
      { id: 'q7', text: 'Which of the following is an Operating System?', options: ['Linux', 'Oracle', 'Python', 'Apache'], correctOptionIndex: 0, marks: 5 },
      { id: 'q8', text: 'In database management, SQL stands for:', options: ['Simple Query Logic', 'Structured Query Language', 'Standard Question Language', 'Sequential Query Loop'], correctOptionIndex: 1, marks: 5 },
      { id: 'q9', text: '1 Byte is equal to how many bits?', options: ['4 bits', '8 bits', '16 bits', '32 bits'], correctOptionIndex: 1, marks: 5 },
      { id: 'q10', text: 'Which company created the Flutter framework?', options: ['Microsoft', 'Apple', 'Google', 'Meta'], correctOptionIndex: 2, marks: 5 },
    ];

    await db.collection('tests').doc(testId).set({
      id: testId,
      title: 'Monthly Institute Comprehensive CBT Assessment',
      subject: 'Computer Concepts & Programming',
      course: 'All Courses',
      batch: 'All Batches',
      targetType: 'all',
      date: new Date().toISOString().split('T')[0],
      time: '10:00 AM',
      durationMinutes: 30,
      totalQuestions: 10,
      totalMarks: 50,
      passingMarks: 20,
      marksPerQuestion: 5,
      hasNegativeMarking: false,
      negativeMarks: 0,
      status: 'live',
      isLive: true,
      questions: questions,
      isSynthetic: true,
      createdAt: nowIso,
    });
    if (!this.manifest.tests.includes(testId)) this.manifest.tests.push(testId);
    console.log(`✔ Seeded Live CBT Examination: ${testId}`);

    this._saveManifest();
  }

  async seedAdminAccount() {
    console.log('⏳ Provisioning Synthetic Test Admin Account...');
    const adminEmail = `perf_admin@test.students.avani.internal`;
    const adminPassword = `PerfAdminPass123!`;
    const adminName = 'Test Administrator';

    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(adminEmail);
      console.log(`   Admin auth user exists (UID: ${userRecord.uid})`);
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        userRecord = await auth.createUser({
          email: adminEmail,
          password: adminPassword,
          displayName: adminName,
        });
        console.log(`   Created admin auth user (UID: ${userRecord.uid})`);
      } else {
        throw e;
      }
    }

    await auth.setCustomUserClaims(userRecord.uid, {
      role: 'admin',
      admin: true,
    });

    const nowIso = new Date().toISOString();
    await db.collection('admins').doc(userRecord.uid).set({
      uid: userRecord.uid,
      userId: userRecord.uid,
      email: adminEmail,
      name: adminName,
      role: 'admin',
      isActive: true,
      active: true,
      isSynthetic: true,
      updatedAt: nowIso,
    }, { merge: true });

    this.manifest.admin = {
      uid: userRecord.uid,
      email: adminEmail,
      password: adminPassword,
      name: adminName,
    };
    this._saveManifest();
    console.log(`✔ Test Admin Provisioned (UID: ${userRecord.uid})`);
    return this.manifest.admin;
  }

  async seedStudents(targetCount) {
    console.log(`⏳ Provisioning ${targetCount} Synthetic Student Accounts...`);
    const nowIso = new Date().toISOString();
    const todayIso = new Date().toISOString().split('T')[0];
    const password = 'PerfStudentPass123!';

    const currentExistingCount = this.manifest.students.length;
    const toSeedIndices = [];
    for (let i = currentExistingCount; i < targetCount; i++) {
      toSeedIndices.push(i);
    }

    const CHUNK_SIZE = 5;
    for (let c = 0; c < toSeedIndices.length; c += CHUNK_SIZE) {
      const chunk = toSeedIndices.slice(c, c + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (i) => {
          const idx = i + 1;
          const email = `perf_student_${idx}@test.students.avani.internal`;
          const rollNo = `PERF-${idx.toString().padStart(4, '0')}`;
          const studentName = `Test Student ${idx}`;
          const course = COURSES_LIST[i % COURSES_LIST.length];
          const batchName = `${course.name} - ${i % 2 === 0 ? 'Morning Batch A' : 'Evening Batch B'}`;

          const userRecord = await retryWithBackoff(async () => {
            try {
              return await auth.getUserByEmail(email);
            } catch (e) {
              if (e.code === 'auth/user-not-found') {
                return await auth.createUser({
                  email,
                  password,
                  displayName: studentName,
                });
              }
              throw e;
            }
          });

          // Student Document
          await db.collection('students').doc(userRecord.uid).set({
            id: userRecord.uid,
            uid: userRecord.uid,
            name: studentName,
            fullName: studentName,
            email: email,
            internalEmail: email,
            rollNo: rollNo,
            rollNumber: rollNo,
            studentId: rollNo,
            course: course.name,
            batch: batchName,
            totalFees: course.fee,
            paidFees: 3000,
            pendingFees: course.fee - 3000,
            status: 'Active',
            mustChangePassword: false,
            admissionDate: '2026-10-01',
            isSynthetic: true,
            createdAt: nowIso,
            updatedAt: nowIso,
          });

          // Fee Account Document
          await db.collection('fee_accounts').doc(`fee_${userRecord.uid}`).set({
            studentUid: userRecord.uid,
            studentName: studentName,
            rollNo: rollNo,
            courseName: course.name,
            batchName: batchName,
            totalFee: course.fee,
            paidFee: 3000,
            pendingFee: course.fee - 3000,
            installments: [
              { number: 1, title: 'Down Payment', amount: 3000, status: 'paid', dueDate: '2026-10-01', paymentDate: '2026-10-01', utrNo: 'UTR-SEED-01' },
              { number: 2, title: 'Installment 2', amount: 3000, status: 'due', dueDate: '2026-11-01' },
            ],
            isSynthetic: true,
            updatedAt: nowIso,
          });

          // Attendance Record Document
          await db.collection('students').doc(userRecord.uid).collection('attendance_records').doc(todayIso).set({
            recordId: todayIso,
            studentUid: userRecord.uid,
            date: todayIso,
            dateKey: todayIso,
            status: 'PRESENT',
            inTime: '08:05 AM',
            outTime: '--:--',
            punchInTime: '08:05 AM',
            punchOutTime: '--:--',
            verificationMethod: 'QR_SCAN',
            isSynthetic: true,
          });

          // Student ID Lookup
          await db.collection('student_id_lookup').doc(rollNo).set({
            uid: userRecord.uid,
            email: email,
            studentId: rollNo,
            isSynthetic: true,
          });

          this.manifest.students.push({
            uid: userRecord.uid,
            email,
            password,
            name: studentName,
            rollNo,
            course: course.name,
            batch: batchName,
          });
        })
      );
      await new Promise((r) => setTimeout(r, 60));
      console.log(`   Seeded ${Math.min(targetCount, currentExistingCount + c + chunk.length)}/${targetCount} students...`);
      this._saveManifest();
    }

    this._saveManifest();
    console.log(`✔ Finished seeding. Total synthetic students available: ${this.manifest.students.length}`);
    return this.manifest.students.slice(0, targetCount);
  }
}

module.exports = SafeSeeder;
