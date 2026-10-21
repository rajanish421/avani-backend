const { initializeApp, deleteApp } = require('firebase/app');
const {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} = require('firebase/auth');
const {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  setDoc,
  query,
  where,
  serverTimestamp,
} = require('firebase/firestore');
const {
  getDatabase,
  ref,
  set,
  update,
  onDisconnect,
  remove,
} = require('firebase/database');

const { firebaseConfig, TEST_PREFIX } = require('./config');
const { metrics } = require('./metrics_collector');

class StudentAgent {
  constructor(studentInfo, workerIndex) {
    this.studentInfo = studentInfo;
    this.workerIndex = workerIndex;
    this.appName = `student_agent_${workerIndex}_${Date.now()}`;
    this.app = null;
    this.auth = null;
    this.db = null;
    this.rtdb = null;
    this.user = null;
    this.activeSubscriptions = [];
  }

  async initialize() {
    this.app = initializeApp(firebaseConfig, this.appName);
    this.auth = getAuth(this.app);
    this.db = getFirestore(this.app);
    this.rtdb = getDatabase(this.app);
  }

  async runFullWorkflow(options = {}) {
    const { examDurationSec = 6, heartbeatIntervalSec = 3 } = options;
    const tStart = Date.now();

    try {
      // 1. Authenticate (Real Firebase Client Auth)
      await this.login();

      // 2. Load Home Dashboard (Replicates home_repository.dart)
      await this.loadHomeDashboard();

      // 3. View Profile & ID Card
      await this.viewProfile();

      // 4. View Timetable
      await this.viewTimetable();

      // 5. View Attendance History & Punch In QR Token
      await this.viewAttendanceAndPunch();

      // 6. View Study Materials
      await this.viewStudyMaterials();

      // 7. Live CBT Exam Workflow
      await this.takeCbtExam({
        durationSec: examDurationSec,
        heartbeatIntervalSec,
      });

      // 8. View Exam Results
      await this.viewExamResults();

      // 9. View Fee Details & Submit Payment Verification
      await this.viewFeesAndSubmitPayment();

      // 10. View Announcements & Notifications
      await this.viewNotifications();

      metrics.recordLatency('StudentFullWorkflow', Date.now() - tStart);
      return { success: true, uid: this.studentInfo.uid };
    } catch (err) {
      metrics.recordError(`StudentWorkflow_${this.studentInfo.uid}`, err);
      return { success: false, uid: this.studentInfo.uid, error: err.message };
    } finally {
      await this.cleanup();
    }
  }

  async login(retries = 3) {
    const t0 = Date.now();
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const cred = await signInWithEmailAndPassword(
          this.auth,
          this.studentInfo.email,
          this.studentInfo.password
        );
        this.user = cred.user;
        metrics.recordLogin(true);
        metrics.recordLatency('StudentLogin', Date.now() - t0);
        return;
      } catch (e) {
        if (
          attempt < retries &&
          (e.code === 'auth/network-request-failed' || e.message?.includes('fetch failed'))
        ) {
          await new Promise((r) => setTimeout(r, attempt * 600));
          continue;
        }
        metrics.recordLogin(false, e);
        throw e;
      }
    }
  }

  async loadHomeDashboard() {
    const t0 = Date.now();
    const uid = this.user.uid;
    const todayIso = new Date().toISOString().split('T')[0];

    // Replicate queries from home_repository.dart:
    // 1. Student Profile Doc
    const sDoc = await getDoc(doc(this.db, 'students', uid));
    metrics.recordFirestoreReads(1, 600);

    // 2. Fee Account Doc
    const fDoc = await getDoc(doc(this.db, 'fee_accounts', `fee_${uid}`));
    metrics.recordFirestoreReads(1, 450);

    // 3. Today's Attendance Record Doc
    const attToday = await getDoc(doc(this.db, 'students', uid, 'attendance_records', todayIso));
    metrics.recordFirestoreReads(1, 300);

    // 4. Student Attendance Records Subcollection (Total history)
    const allAtt = await getDocs(collection(this.db, 'students', uid, 'attendance_records'));
    metrics.recordFirestoreReads(Math.max(1, allAtt.size), 300);

    // 5. Batches Collection (Home screen listens to ALL batches)
    const batchesSnap = await getDocs(collection(this.db, 'batches'));
    metrics.recordFirestoreReads(Math.max(1, batchesSnap.size), 400);

    // 6. Study Materials (Home screen queries all materials)
    const matsSnap = await getDocs(collection(this.db, 'study_materials'));
    metrics.recordFirestoreReads(Math.max(1, matsSnap.size), 400);

    // 7. Test Submissions
    try {
      const subsQ = query(collection(this.db, 'test_submissions'), where('studentUid', '==', uid));
      const subsSnap = await getDocs(subsQ);
      metrics.recordFirestoreReads(Math.max(1, subsSnap.size), 500);
    } catch (_) {}

    // 8. Active Live Classes (where isLive == true)
    const liveQ = query(collection(this.db, 'live_classes'), where('isLive', '==', true));
    const liveSnap = await getDocs(liveQ);
    metrics.recordFirestoreReads(Math.max(1, liveSnap.size), 450);

    metrics.recordLatency('LoadHomeDashboard', Date.now() - t0);
  }

  async viewProfile() {
    const t0 = Date.now();
    const sDoc = await getDoc(doc(this.db, 'students', this.user.uid));
    metrics.recordFirestoreReads(1, 600);
    metrics.recordLatency('ViewProfile', Date.now() - t0);
  }

  async viewTimetable() {
    const t0 = Date.now();
    // Query student's assigned batches
    const batchesSnap = await getDocs(collection(this.db, 'batches'));
    metrics.recordFirestoreReads(Math.max(1, batchesSnap.size), 400);
    metrics.recordLatency('ViewTimetable', Date.now() - t0);
  }

  async viewAttendanceAndPunch() {
    const t0 = Date.now();
    const uid = this.user.uid;

    // Read attendance records for attendance screen
    const attSnap = await getDocs(collection(this.db, 'students', uid, 'attendance_records'));
    metrics.recordFirestoreReads(Math.max(1, attSnap.size), 300);

    // Read student document for QR code attendance token display
    const studentDoc = await getDoc(doc(this.db, 'students', uid));
    metrics.recordFirestoreReads(1, 400);

    metrics.recordLatency('AttendanceAndPunch', Date.now() - t0);
  }

  async viewStudyMaterials() {
    const t0 = Date.now();
    const matsSnap = await getDocs(collection(this.db, 'study_materials'));
    metrics.recordFirestoreReads(Math.max(1, matsSnap.size), 400);
    metrics.recordLatency('ViewStudyMaterials', Date.now() - t0);
  }

  async takeCbtExam({ durationSec = 6, heartbeatIntervalSec = 3 }) {
    const t0 = Date.now();
    const uid = this.user.uid;
    const testId = `${TEST_PREFIX}exam_cbt_1`;

    // 1. Fetch Exam Paper from Firestore
    const testDoc = await getDoc(doc(this.db, 'tests', testId));
    metrics.recordFirestoreReads(1, 1200);

    const testData = testDoc.data() || {};
    const totalQ = testData.questions?.length || 10;

    // 2. Initialize Realtime Database Session
    const sessionRef = ref(this.rtdb, `live_exams/${testId}/sessions/${uid}`);
    await set(sessionRef, {
      studentUid: uid,
      studentName: this.studentInfo.name,
      studentRollNo: this.studentInfo.rollNo,
      batchName: this.studentInfo.batch,
      status: 'in_progress',
      startedAt: Date.now(),
      lastHeartbeat: Date.now(),
      timeRemainingSeconds: 1800,
      currentQuestionIndex: 0,
      answeredCount: 0,
      totalQuestions: totalQ,
      violationsCount: 0,
      extraTimeMinutes: 0,
      isOnline: true,
      isLocked: false,
      currentScore: 0,
      lastActivity: 'Started Exam',
    });
    metrics.recordRtdbWrite(350);

    // OnDisconnect Hook
    await onDisconnect(sessionRef).update({
      isOnline: false,
      isLocked: true,
      lastHeartbeat: Date.now(),
    });

    // 3. Heartbeat & Question Progress Simulation
    let remainingTime = 1800;
    let answered = 0;
    const numHeartbeats = Math.max(1, Math.floor(durationSec / heartbeatIntervalSec));

    for (let i = 0; i < numHeartbeats; i++) {
      await new Promise((res) => setTimeout(res, heartbeatIntervalSec * 1000));
      remainingTime -= heartbeatIntervalSec;
      answered = Math.min(totalQ, answered + 2);

      await update(sessionRef, {
        lastHeartbeat: Date.now(),
        timeRemainingSeconds: remainingTime,
        currentQuestionIndex: answered,
        answeredCount: answered,
        currentScore: answered * 5,
        lastActivity: `Active on Q${answered + 1}`,
        isOnline: true,
      });
      metrics.recordRtdbWrite(250);
    }

    // 4. Submit Exam to Firestore (test_submissions)
    const submissionId = `${testId}_${uid}`;
    try {
      const existingSub = await getDoc(doc(this.db, 'test_submissions', submissionId));
      metrics.recordFirestoreReads(1, 400);

      if (!existingSub.exists()) {
        await setDoc(doc(this.db, 'test_submissions', submissionId), {
          id: submissionId,
          testId: testId,
          testTitle: testData.title || 'CBT Assessment',
          studentUid: uid,
          studentName: this.studentInfo.name,
          studentRollNo: this.studentInfo.rollNo,
          batchName: this.studentInfo.batch,
          courseName: this.studentInfo.course,
          totalQuestions: totalQ,
          attemptedCount: answered,
          correctCount: answered,
          wrongCount: 0,
          unattemptedCount: totalQ - answered,
          score: answered * 5,
          maxMarks: totalQ * 5,
          percentage: (answered / totalQ) * 100,
          passed: true,
          answers: { q_0: 0, q_1: 1, q_2: 1, q_3: 2 },
          violationsCount: 0,
          disqualified: false,
          timeTakenSeconds: durationSec,
          submittedAt: serverTimestamp(),
          isSynthetic: true,
        });
        metrics.recordFirestoreWrites(1, 950);
      }
    } catch (e) {
      metrics.recordError(`SubmitExam_${uid}`, e);
    }

    // 5. Clean up RTDB Live Session upon submission
    await remove(sessionRef);
    metrics.recordRtdbWrite(100);

    metrics.recordLatency('TakeCbtExam', Date.now() - t0);
  }

  async viewExamResults() {
    const t0 = Date.now();
    const submissionId = `${TEST_PREFIX}exam_cbt_1_${this.user.uid}`;
    const subDoc = await getDoc(doc(this.db, 'test_submissions', submissionId));
    metrics.recordFirestoreReads(1, 800);
    metrics.recordLatency('ViewExamResults', Date.now() - t0);
  }

  async viewFeesAndSubmitPayment() {
    const t0 = Date.now();
    const uid = this.user.uid;

    // 1. Read Fee Account
    const feeDoc = await getDoc(doc(this.db, 'fee_accounts', `fee_${uid}`));
    metrics.recordFirestoreReads(1, 450);

    // 2. Submit Payment Verification Request
    const paymentId = `PAY_${uid}_${Date.now()}`;
    await setDoc(doc(this.db, 'fee_payments', paymentId), {
      studentUid: uid,
      studentName: this.studentInfo.name,
      amount: 3000,
      installmentNumber: 2,
      mode: 'UPI',
      status: 'Pending Verification',
      utrNo: `UTR-SIM-${Date.now().toString().slice(-6)}`,
      date: new Date().toISOString().split('T')[0],
      createdAt: serverTimestamp(),
      isSynthetic: true,
    });
    metrics.recordFirestoreWrites(1, 400);

    metrics.recordLatency('ViewFeesAndSubmitPayment', Date.now() - t0);
  }

  async viewNotifications() {
    const t0 = Date.now();
    const uid = this.user.uid;

    // Query notifications
    const notifQ = query(collection(this.db, 'notifications'), where('studentUid', '==', uid));
    const notifSnap = await getDocs(notifQ);
    metrics.recordFirestoreReads(Math.max(1, notifSnap.size), 350);

    // Query announcements
    const annSnap = await getDocs(collection(this.db, 'announcements'));
    metrics.recordFirestoreReads(Math.max(1, annSnap.size), 400);

    metrics.recordLatency('ViewNotifications', Date.now() - t0);
  }

  async cleanup() {
    for (const unsub of this.activeSubscriptions) {
      try {
        unsub();
      } catch (_) {}
    }
    this.activeSubscriptions = [];

    if (this.auth && this.user) {
      try {
        await signOut(this.auth);
      } catch (_) {}
    }

    if (this.app) {
      try {
        await deleteApp(this.app);
      } catch (_) {}
    }
  }
}

module.exports = StudentAgent;
