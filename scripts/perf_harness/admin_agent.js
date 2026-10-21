const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  updateDoc,
} = require('firebase/firestore');
const { getDatabase, ref, onValue, off } = require('firebase/database');

const { firebaseConfig, TEST_PREFIX } = require('./config');
const { metrics } = require('./metrics_collector');

class AdminAgent {
  constructor(adminInfo) {
    this.adminInfo = adminInfo;
    this.appName = `admin_agent_${Date.now()}`;
    this.app = null;
    this.auth = null;
    this.db = null;
    this.rtdb = null;
    this.user = null;
    this.monitoringRef = null;
    this.rtdbEventsReceived = 0;
  }

  async initialize() {
    this.app = initializeApp(firebaseConfig, this.appName);
    this.auth = getAuth(this.app);
    this.db = getFirestore(this.app);
    this.rtdb = getDatabase(this.app);
  }

  async login(retries = 3) {
    const t0 = Date.now();
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const cred = await signInWithEmailAndPassword(
          this.auth,
          this.adminInfo.email,
          this.adminInfo.password
        );
        this.user = cred.user;
        metrics.recordLogin(true);
        metrics.recordLatency('AdminLogin', Date.now() - t0);
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

  async loadOverviewDashboard() {
    const t0 = Date.now();

    // 1. Courses Stream Snapshot
    const coursesSnap = await getDocs(collection(this.db, 'courses'));
    metrics.recordFirestoreReads(Math.max(1, coursesSnap.size), 400);

    // 2. Batches Stream Snapshot
    const batchesSnap = await getDocs(collection(this.db, 'batches'));
    metrics.recordFirestoreReads(Math.max(1, batchesSnap.size), 400);

    // 3. Students Stream Snapshot (Admin loads all students!)
    const studentsSnap = await getDocs(collection(this.db, 'students'));
    metrics.recordFirestoreReads(Math.max(1, studentsSnap.size), 600);

    // 4. Pending Payment Verifications
    const payQ = query(
      collection(this.db, 'fee_payments'),
      where('status', '==', 'Pending Verification')
    );
    const paySnap = await getDocs(payQ);
    metrics.recordFirestoreReads(Math.max(1, paySnap.size), 450);

    // 5. Tests
    const testsSnap = await getDocs(collection(this.db, 'tests'));
    metrics.recordFirestoreReads(Math.max(1, testsSnap.size), 600);

    metrics.recordLatency('AdminLoadOverviewDashboard', Date.now() - t0);
  }

  startLiveExamMonitoring(testId = `${TEST_PREFIX}exam_cbt_1`) {
    this.monitoringRef = ref(this.rtdb, `live_exams/${testId}/sessions`);

    onValue(this.monitoringRef, (snapshot) => {
      this.rtdbEventsReceived++;
      const val = snapshot.val();
      const numActive = val ? Object.keys(val).length : 0;
      metrics.setRtdbConnections(numActive + 1); // Students + 1 Admin
      metrics.recordRtdbEventReceived(JSON.stringify(val || {}).length);
    });
  }

  stopLiveExamMonitoring() {
    if (this.monitoringRef) {
      try {
        off(this.monitoringRef);
      } catch (_) {}
      this.monitoringRef = null;
    }
  }

  async viewStudentDetails(studentUid) {
    if (!studentUid) return;
    const t0 = Date.now();
    try {
      const sDoc = await getDoc(doc(this.db, 'students', studentUid));
      metrics.recordFirestoreReads(1, 600);
      const attSnap = await getDocs(collection(this.db, 'students', studentUid, 'attendance_records'));
      metrics.recordFirestoreReads(Math.max(1, attSnap.size), 300);
      metrics.recordLatency('AdminViewStudentDetails', Date.now() - t0);
    } catch (_) {}
  }

  async verifyPendingPayments() {
    const t0 = Date.now();
    try {
      const payQ = query(
        collection(this.db, 'fee_payments'),
        where('status', '==', 'Pending Verification')
      );
      const snap = await getDocs(payQ);
      metrics.recordFirestoreReads(Math.max(1, snap.size), 450);

      // Verify up to 3 payments
      let verifiedCount = 0;
      for (const d of snap.docs) {
        if (verifiedCount >= 3) break;
        await updateDoc(d.ref, {
          status: 'Verified',
          verifiedBy: this.user.uid,
          verifiedAt: new Date().toISOString(),
        });
        metrics.recordFirestoreWrites(1, 400);
        verifiedCount++;
      }
      metrics.recordLatency('AdminVerifyPendingPayments', Date.now() - t0);
    } catch (_) {}
  }

  async viewExamReports(testId = `${TEST_PREFIX}exam_cbt_1`) {
    const t0 = Date.now();
    try {
      const qSub = query(collection(this.db, 'test_submissions'), where('testId', '==', testId));
      const snap = await getDocs(qSub);
      metrics.recordFirestoreReads(Math.max(1, snap.size), 750);
      metrics.recordLatency('AdminViewExamReports', Date.now() - t0);
    } catch (_) {}
  }

  async viewAttendanceDashboard() {
    const t0 = Date.now();
    try {
      const attSnap = await getDocs(collection(this.db, 'attendance'));
      metrics.recordFirestoreReads(Math.max(1, attSnap.size), 350);
      metrics.recordLatency('AdminViewAttendanceDashboard', Date.now() - t0);
    } catch (_) {}
  }

  async verifyPaymentProof(paymentId) {
    if (!paymentId) return;
    const t0 = Date.now();
    try {
      await updateDoc(doc(this.db, 'fee_payments', paymentId), {
        status: 'Verified',
        verifiedBy: this.user.uid,
        verifiedAt: new Date().toISOString(),
      });
      metrics.recordFirestoreWrites(1, 400);
      metrics.recordLatency('AdminVerifyPayment', Date.now() - t0);
    } catch (e) {
      // Ignored if document doesn't exist
    }
  }

  async cleanup() {
    this.stopLiveExamMonitoring();

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

module.exports = AdminAgent;
