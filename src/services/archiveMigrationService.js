const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { db, FieldValue } = require('../config/firebase');
const { connectMongo } = require('../config/mongodb');
const ArchivedStudent = require('../models/ArchivedStudent');
const ArchivedBatch = require('../models/ArchivedBatch');
const MigrationAuditLog = require('../models/MigrationAuditLog');

class ArchiveMigrationService {
  static _activeLocks = new Set();

  /**
   * Helper to format today's date in IST (YYYY-MM-DD)
   */
  static getTodayIST() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  /**
   * Calculate deterministic SHA-256 hash of core payload
   */
  static calculateChecksum(data) {
    const serialized = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  // ==========================================================================
  // PREVIEW OPERATIONS
  // ==========================================================================

  /**
   * Pre-flight analysis before archiving a single student
   */
  static async previewStudentMigration(studentUid) {
    if (!studentUid) throw new Error('studentUid is required for preview');

    const studentDoc = await db.collection('students').doc(studentUid).get();
    if (!studentDoc.exists) {
      await connectMongo();
      const existingArchived = await ArchivedStudent.findOne({ studentUid });
      if (existingArchived) {
        return {
          studentUid,
          studentId: existingArchived.studentId,
          name: existingArchived.name,
          course: existingArchived.course,
          batch: existingArchived.batch,
          currentStatus: 'Completed',
          alreadyArchived: true,
          suggestedCompletionDate: existingArchived.completionDate,
          feeStatus: {
            totalFee: existingArchived.feeSummary?.totalFee || 0,
            paidFee: existingArchived.feeSummary?.paidFee || 0,
            pendingFee: existingArchived.feeSummary?.pendingFee || 0,
            isCleared: (existingArchived.feeSummary?.pendingFee || 0) <= 0,
          },
          academics: {
            testsSubmittedCount: existingArchived.testResults?.length || 0,
            certificatesCount: existingArchived.certificates?.length || 0,
            attendancePercentage: existingArchived.attendanceSummary?.averageAttendancePct || 0,
          },
          readyForArchive: false,
          warnings: ['This student has already been archived to Institute Permanent Records.'],
        };
      }
      throw new Error(`Student ${studentUid} not found in Firestore`);
    }

    const studentData = studentDoc.data();

    // Concurrently fetch fee account, certificates, and test submissions
    const [feeDoc, certSnap, testsSnap] = await Promise.all([
      db.collection('fee_accounts').doc(`fee_${studentUid}`).get().catch(() => ({ exists: false, data: () => ({}) })),
      db.collection('certificates').where('studentId', '==', studentUid).get().catch(() => ({ size: 0 })),
      db.collection('test_submissions').where('studentUid', '==', studentUid).get().catch(() => ({ size: 0 })),
    ]);

    const feeData = feeDoc.exists ? feeDoc.data() : {};

    const totalFee = Number(feeData.totalFee ?? studentData.totalFees ?? 0);
    const paidFee = Number(feeData.paidFee ?? studentData.paidFees ?? 0);
    const pendingFee = Math.max(0, totalFee - paidFee);

    return {
      studentUid,
      studentId: studentData.studentId || studentData.rollNo || '',
      name: studentData.name || '',
      course: studentData.course || '',
      batch: studentData.batch || '',
      currentStatus: studentData.status || 'Active',
      admissionDate: studentData.admissionDate || '',
      suggestedCompletionDate: this.getTodayIST(),
      feeStatus: {
        totalFee,
        paidFee,
        pendingFee,
        isCleared: pendingFee <= 0,
      },
      academics: {
        testsSubmittedCount: testsSnap.size,
        certificatesCount: certSnap.size,
        attendancePercentage: Number(studentData.attendancePct || 0),
      },
      readyForArchive: true,
      warnings: pendingFee > 0 ? [`Student has a pending fee balance of ₹${pendingFee}`] : [],
    };
  }

  /**
   * Pre-flight analysis before archiving an entire batch
   */
  static async previewBatchMigration(batchId) {
    if (!batchId) throw new Error('batchId is required for preview');

    const batchDoc = await db.collection('batches').doc(batchId).get();
    if (!batchDoc.exists) {
      await connectMongo();
      const existingBatch = await ArchivedBatch.findOne({ batchId });
      if (existingBatch) {
        return {
          batchId,
          code: existingBatch.code,
          name: existingBatch.name,
          course: existingBatch.course,
          status: 'Archived',
          alreadyArchived: true,
          totalStudents: existingBatch.completedStudentsCount || 0,
          feeOverview: {
            studentsWithClearedFees: existingBatch.completedStudentsCount || 0,
            studentsWithPendingFees: 0,
            totalPendingFeeSum: 0,
          },
          students: [],
          readyForArchive: false,
          warnings: ['This batch has already been archived to Institute Permanent Records.'],
        };
      }
      throw new Error(`Batch ${batchId} not found in Firestore`);
    }

    const batchData = batchDoc.data();

    // Find all students in this batch
    let studentDocs = [];
    const assignedIds = batchData.assignedStudentIds || [];

    if (assignedIds.length > 0) {
      // Fetch by assigned IDs
      const promises = assignedIds.map((uid) => db.collection('students').doc(uid).get());
      const snaps = await Promise.all(promises);
      studentDocs = snaps.filter((s) => s.exists);
    } else {
      // Query by batchId or batch name
      const snap = await db
        .collection('students')
        .where('batchId', '==', batchId)
        .get();
      if (!snap.empty) {
        studentDocs = snap.docs;
      } else {
        const nameSnap = await db
          .collection('students')
          .where('batch', '==', batchData.name)
          .get();
        studentDocs = nameSnap.docs;
      }
    }

    const totalBatchStudents = studentDocs.length;
    let studentsWithClearedFees = 0;
    let studentsWithPendingFees = 0;
    let totalPendingFeeSum = 0;

    // Fetch fee records for all batch students concurrently
    const feeDocs = await Promise.all(
      studentDocs.map((doc) =>
        db.collection('fee_accounts').doc(`fee_${doc.id}`).get().catch(() => ({ exists: false, data: () => ({}) }))
      )
    );

    const studentSummaries = [];

    for (let i = 0; i < studentDocs.length; i++) {
      const doc = studentDocs[i];
      const s = doc.data();
      const feeDoc = feeDocs[i];
      const f = feeDoc.exists ? feeDoc.data() : {};
      const totalFee = Number(f.totalFee ?? s.totalFees ?? 0);
      const paidFee = Number(f.paidFee ?? s.paidFees ?? 0);
      const pending = Math.max(0, totalFee - paidFee);

      if (pending <= 0) {
        studentsWithClearedFees++;
      } else {
        studentsWithPendingFees++;
        totalPendingFeeSum += pending;
      }

      studentSummaries.push({
        studentUid: doc.id,
        studentId: s.studentId || s.rollNo || '',
        name: s.name || '',
        pendingFee: pending,
        status: s.status || 'Active',
      });
    }

    return {
      batchId,
      code: batchData.code || '',
      name: batchData.name || '',
      course: batchData.course || '',
      startDate: batchData.startDate || '',
      endDate: batchData.endDate || '',
      currentStatus: batchData.status || 'Active',
      totalStudents: totalBatchStudents,
      feeOverview: {
        studentsWithClearedFees,
        studentsWithPendingFees,
        totalPendingFeeSum,
      },
      readyForArchive: totalBatchStudents > 0,
      students: studentSummaries,
      warnings:
        studentsWithPendingFees > 0
          ? [`${studentsWithPendingFees} student(s) have pending fees totaling ₹${totalPendingFeeSum}`]
          : [],
    };
  }

  // ==========================================================================
  // SINGLE STUDENT MIGRATION
  // ==========================================================================

  /**
   * Migrate a single student to MongoDB and prune operational records from Firestore
   */
  static async migrateStudent({ studentUid, adminUid = 'admin', force = false, migrationId = null }) {
    if (!studentUid) throw new Error('studentUid is required for migration');

    await connectMongo();

    const lockKey = `student:${studentUid}`;
    if (this._activeLocks.has(lockKey)) {
      throw new Error(`Migration for student ${studentUid} is currently in progress`);
    }
    this._activeLocks.add(lockKey);

    const activeMigrationId = migrationId
      ? `${migrationId}_stu_${studentUid}`
      : `mig_stu_${Date.now()}_${uuidv4().substring(0, 8)}`;
    let auditLog = null;

    try {
      // 1. Audit Log: IN_PROGRESS
      auditLog = await MigrationAuditLog.create({
        migrationId: activeMigrationId,
        type: 'student',
        targetId: studentUid,
        adminUid,
        status: 'IN_PROGRESS',
        studentUids: [studentUid],
        studentCount: 1,
        startedAt: new Date(),
      });

      // 2. Fetch full operational data from Firestore
      const studentDoc = await db.collection('students').doc(studentUid).get();
      if (!studentDoc.exists) {
        const existingArchived = await ArchivedStudent.findOne({ studentUid });
        if (existingArchived) {
          console.log(`[ARCHIVE] Student ${studentUid} is already migrated to MongoDB and pruned from Firestore.`);
          auditLog.status = 'COMPLETED';
          auditLog.verificationPassed = true;
          auditLog.firestorePruned = true;
          auditLog.completedAt = new Date();
          await auditLog.save().catch(() => {});
          return {
            success: true,
            migrationId: activeMigrationId,
            studentUid,
            studentId: existingArchived.studentId,
            name: existingArchived.name,
            completionDate: existingArchived.completionDate,
            verified: true,
            alreadyArchived: true,
          };
        }
        throw new Error(`Student ${studentUid} not found in Firestore`);
      }
      const sData = studentDoc.data();
      auditLog.targetName = sData.name || 'Student';

      // Check if already completed and force is false
      if (sData.status === 'Completed' && sData.isArchived === true && !force) {
        console.log(`[ARCHIVE] Student ${studentUid} is already completed/archived. Re-verifying archive.`);
      }

      // Concurrently fetch Fee Account, Payments, Attendance, Tests, Certificates, and existingArchived
      const [feeDoc, paymentsSnap, attSubSnap, testSnap, certSnap, existingArchived] = await Promise.all([
        db.collection('fee_accounts').doc(`fee_${studentUid}`).get().catch(() => ({ exists: false, data: () => ({}) })),
        db.collection('fee_payments').where('studentUid', '==', studentUid).get().catch(() => ({ docs: [] })),
        db.collection('students').doc(studentUid).collection('attendance_records').get().catch(() => ({ docs: [] })),
        db.collection('test_submissions').where('studentUid', '==', studentUid).get().catch(() => ({ docs: [] })),
        db.collection('certificates').where('studentId', '==', studentUid).get().catch(() => ({ docs: [] })),
        ArchivedStudent.findOne({ studentUid }).lean().catch(() => null),
      ]);

      const feeData = feeDoc.exists ? feeDoc.data() : {};

      const payments = paymentsSnap.docs.map((d) => ({
        paymentId: d.id,
        amount: Number(d.data().amount || 0),
        date: d.data().paymentDate || d.data().createdAt || '',
        method: d.data().method || d.data().paymentMode || 'Online',
        transactionId: d.data().transactionId || '',
        receiptNo: d.data().receiptNo || d.data().receiptNumber || '',
        status: d.data().status || 'Approved',
        verifiedAt: d.data().verifiedAt || '',
      }));

      const attRecords = attSubSnap.docs.map((d) => ({
        id: d.id,
        date: d.data().date || '',
        status: d.data().status || 'Present',
        time: d.data().time || '',
      }));

      const attendedCount = attRecords.filter((r) => r.status.toLowerCase() === 'present').length;
      const totalAttClasses = attRecords.length > 0 ? attRecords.length : Number(sData.totalClassesHeld || 0);

      const testResults = testSnap.docs.map((d) => ({
        testId: d.data().testId || d.id,
        testTitle: d.data().testTitle || d.data().title || 'Module Exam',
        score: Number(d.data().score ?? d.data().marksObtained ?? 0),
        totalMarks: Number(d.data().totalMarks ?? d.data().maxMarks ?? 100),
        percentage: Number(d.data().percentage ?? 0),
        grade: d.data().grade || 'Pass',
        passed: Boolean(d.data().passed ?? true),
        date: d.data().submittedAt || '',
      }));

      const certificates = certSnap.docs.map((d) => ({
        certificateId: d.id,
        certificateNo: d.data().certificateNo || d.data().certNo || '',
        title: d.data().title || sData.course || 'Certificate of Completion',
        issueDate: d.data().issueDate || this.getTodayIST(),
        grade: d.data().grade || 'A',
        downloadUrl: d.data().downloadUrl || d.data().pdfUrl || '',
      }));

      // Preserve snapshot if feeDoc was already pruned in earlier migration
      const preservedFeeAccount = (feeDoc.exists && Object.keys(feeData).length > 0)
        ? feeData
        : (existingArchived?.originalSnapshot?.feeAccount || {});
      const preservedStudent = (studentDoc.exists && Object.keys(sData).length > 0)
        ? sData
        : (existingArchived?.originalSnapshot?.student || {});

      // 3. Compile Full Archive Record
      const totalFee = feeDoc.exists
        ? Number(feeData.totalFee ?? sData.totalFees ?? 0)
        : Number(existingArchived?.feeSummary?.totalFee ?? sData.totalFees ?? 0);
      const paidFee = feeDoc.exists
        ? Number(feeData.paidFee ?? sData.paidFees ?? 0)
        : Number(existingArchived?.feeSummary?.paidFee ?? sData.paidFees ?? 0);
      const pendingFee = Math.max(0, totalFee - paidFee);

      const isInstallmentPlan = feeDoc.exists
        ? Boolean(feeData.isInstallmentPlan)
        : Boolean(existingArchived?.feeSummary?.isInstallmentPlan);
      const installments = feeDoc.exists
        ? (feeData.installments || [])
        : (existingArchived?.feeSummary?.installments || []);

      const completionDate = sData.completionDate || existingArchived?.completionDate || this.getTodayIST();

      const coreData = {
        studentUid,
        studentId: sData.studentId || sData.rollNo || '',
        name: sData.name || '',
        course: sData.course || '',
        totalFee,
        paidFee,
        completionDate,
      };
      const checksum = this.calculateChecksum(coreData);

      const archivedPayload = {
        studentUid,
        studentId: sData.studentId || sData.rollNo || '',
        registrationNo: sData.registrationNo || sData.regNo || '',
        name: sData.name || '',
        dob: sData.dob || '',
        gender: sData.gender || '',
        phone: sData.phone || '',
        email: sData.email || '',
        internalEmail: sData.internalEmail || '',
        category: sData.category || '',
        address: sData.address || '',
        parentName: sData.parentName || sData.fatherName || '',
        parentPhone: sData.parentPhone || '',
        guardianPhone: sData.guardianPhone || '',
        avatarUrl: sData.avatarUrl || sData.photoUrl || '',
        course: sData.course || '',
        courseId: sData.courseId || '',
        batch: sData.batch || '',
        batchId: sData.batchId || '',
        admissionDate: sData.admissionDate || '',
        completionDate,
        status: 'Completed',
        feeSummary: {
          totalFee,
          paidFee,
          pendingFee,
          status: pendingFee <= 0 ? 'Cleared' : 'Pending Dues',
          isInstallmentPlan,
          installments,
        },
        payments: payments.length > 0 ? payments : (existingArchived?.payments || []),
        attendanceSummary: {
          totalClasses: totalAttClasses > 0 ? totalAttClasses : (existingArchived?.attendanceSummary?.totalClasses || 0),
          attendedClasses: attendedCount > 0 ? attendedCount : (existingArchived?.attendanceSummary?.attendedClasses || 0),
          attendancePercentage:
            totalAttClasses > 0
              ? Math.round((attendedCount / totalAttClasses) * 100)
              : Number(existingArchived?.attendanceSummary?.attendancePercentage ?? sData.attendancePct ?? 0),
          lastAttendedDate: attRecords.length > 0 ? attRecords[attRecords.length - 1].date : (existingArchived?.attendanceSummary?.lastAttendedDate || ''),
          records: attRecords.length > 0 ? attRecords : (existingArchived?.attendanceSummary?.records || []),
        },
        testResults: testResults.length > 0 ? testResults : (existingArchived?.testResults || []),
        certificates: certificates.length > 0 ? certificates : (existingArchived?.certificates || []),
        originalSnapshot: {
          student: preservedStudent,
          feeAccount: preservedFeeAccount,
        },
        migrationMetadata: {
          migratedAt: new Date(),
          migratedBy: adminUid,
          migrationId: activeMigrationId,
          checksum,
          version: 1,
        },
      };

      // 4. Upsert into MongoDB
      const savedDoc = await ArchivedStudent.findOneAndUpdate(
        { studentUid },
        archivedPayload,
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );

      // 5. Verification: Read back and assert data integrity
      const verifyDoc = await ArchivedStudent.findOne({ studentUid });
      if (!verifyDoc || verifyDoc.studentId !== archivedPayload.studentId) {
        throw new Error(`Data integrity verification failed for student ${studentUid} in MongoDB`);
      }
      auditLog.verificationPassed = true;

      // 6. Complete Firestore Purge: Delete all records from Firestore to reduce database storage to zero
      const studentIdNorm = sData.studentId || sData.rollNo;

      // Prune ALL heavy operational documents, payments, submissions, attendance and registration requests from Firestore
      const [
        enrDoc,
        qrSnap,
        paymentsSnapToPrune,
        testsSnapToPrune,
        subTestsByRollSnap,
        certsSnapToPrune,
        certsByUidSnapToPrune,
        attRecordsSnapToPrune,
        subTestsSnapToPrune,
        legacyAttSnap,
        legacyAttByRollSnap,
        regReqsByUidSnap,
        regReqsByIdSnap,
      ] = await Promise.all([
        db.collection('enrollments').doc(`enr_${studentUid}`).get().catch(() => ({ exists: false })),
        db.collection('qr_tokens').where('studentUid', '==', studentUid).get().catch(() => ({ docs: [] })),
        db.collection('fee_payments').where('studentUid', '==', studentUid).get().catch(() => ({ docs: [] })),
        db.collection('test_submissions').where('studentUid', '==', studentUid).get().catch(() => ({ docs: [] })),
        studentIdNorm
          ? db.collection('test_submissions').where('studentRoll', '==', studentIdNorm).get().catch(() => ({ docs: [] }))
          : Promise.resolve({ docs: [] }),
        db.collection('certificates').where('studentId', '==', studentUid).get().catch(() => ({ docs: [] })),
        db.collection('certificates').where('studentUid', '==', studentUid).get().catch(() => ({ docs: [] })),
        db.collection('students').doc(studentUid).collection('attendance_records').get().catch(() => ({ docs: [] })),
        db.collection('students').doc(studentUid).collection('test_submissions').get().catch(() => ({ docs: [] })),
        db.collection('attendance').where('studentUid', '==', studentUid).get().catch(() => ({ docs: [] })),
        studentIdNorm
          ? db.collection('attendance').where('studentRoll', '==', studentIdNorm).get().catch(() => ({ docs: [] }))
          : Promise.resolve({ docs: [] }),
        db.collection('registration_requests').where('uid', '==', studentUid).get().catch(() => ({ docs: [] })),
        studentIdNorm
          ? db.collection('registration_requests').where('studentId', '==', studentIdNorm.toUpperCase()).get().catch(() => ({ docs: [] }))
          : Promise.resolve({ docs: [] }),
      ]);

      const pruneBatch = db.batch();

      // Completely remove student root document from Firestore
      pruneBatch.delete(db.collection('students').doc(studentUid));

      // Completely remove student lookup document from Firestore if present
      if (studentIdNorm) {
        pruneBatch.delete(db.collection('student_id_lookup').doc(studentIdNorm.toUpperCase()));
      }

      // Prune fee account
      if (feeDoc.exists) {
        pruneBatch.delete(feeDoc.ref);
      }
      if (enrDoc.exists) {
        pruneBatch.delete(enrDoc.ref);
      }
      (qrSnap.docs || []).forEach((d) => pruneBatch.delete(d.ref));
      (paymentsSnapToPrune.docs || []).forEach((d) => pruneBatch.delete(d.ref));
      (testsSnapToPrune.docs || []).forEach((d) => pruneBatch.delete(d.ref));
      (subTestsByRollSnap.docs || []).forEach((d) => pruneBatch.delete(d.ref));
      (certsSnapToPrune.docs || []).forEach((d) => pruneBatch.delete(d.ref));
      (certsByUidSnapToPrune.docs || []).forEach((d) => pruneBatch.delete(d.ref));
      (attRecordsSnapToPrune.docs || []).forEach((d) => pruneBatch.delete(d.ref));
      (subTestsSnapToPrune.docs || []).forEach((d) => pruneBatch.delete(d.ref));
      (legacyAttSnap.docs || []).forEach((d) => pruneBatch.delete(d.ref));
      (legacyAttByRollSnap.docs || []).forEach((d) => pruneBatch.delete(d.ref));
      (regReqsByUidSnap.docs || []).forEach((d) => pruneBatch.delete(d.ref));
      (regReqsByIdSnap.docs || []).forEach((d) => pruneBatch.delete(d.ref));

      await pruneBatch.commit();

      // Disassociate student from their batch assignedStudentIds if the batch remains active
      const batchIdToUpdate = sData.batchId;
      if (batchIdToUpdate) {
        try {
          const bDoc = await db.collection('batches').doc(batchIdToUpdate).get();
          if (bDoc.exists) {
            const assigned = (bDoc.data().assignedStudentIds || []).filter((id) => id !== studentUid);
            const curEnrolled = Number(bDoc.data().enrolled || 0);
            await bDoc.ref.update({
              assignedStudentIds: assigned,
              enrolled: curEnrolled > 0 ? curEnrolled - 1 : 0,
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (bErr) {
          console.warn(`[ARCHIVE] Non-critical warning updating batch assignedStudentIds for ${studentUid}:`, bErr.message);
        }
      }

      auditLog.firestorePruned = true;

      // 7. Audit Log: COMPLETED
      auditLog.status = 'COMPLETED';
      auditLog.completedAt = new Date();
      auditLog.details = {
        studentUid,
        studentId: sData.studentId || sData.rollNo,
        checksum,
        recordsArchived: {
          paymentsCount: payments.length,
          attendanceRecordsCount: attRecords.length,
          testsCount: testResults.length,
          certificatesCount: certificates.length,
        },
      };
      await auditLog.save();

      console.log(`[ARCHIVE SUCCESS] Student ${studentUid} (${coreData.studentId}) migrated to MongoDB successfully.`);
      return {
        success: true,
        migrationId: activeMigrationId,
        studentUid,
        studentId: coreData.studentId,
        name: coreData.name,
        completionDate,
        verified: true,
      };
    } catch (err) {
      console.error(`[ARCHIVE ERROR] Failed to migrate student ${studentUid}:`, err.message);
      if (auditLog) {
        auditLog.status = 'FAILED';
        auditLog.error = err.message;
        auditLog.completedAt = new Date();
        await auditLog.save().catch(() => {});
      }
      throw err;
    } finally {
      this._activeLocks.delete(lockKey);
    }
  }

  // ==========================================================================
  // FULL BATCH MIGRATION
  // ==========================================================================

  /**
   * Migrate an entire batch and all its students to MongoDB
   */
  static async migrateBatch({ batchId, adminUid = 'admin', force = false }) {
    if (!batchId) throw new Error('batchId is required for batch migration');

    await connectMongo();

    const lockKey = `batch:${batchId}`;
    if (this._activeLocks.has(lockKey)) {
      throw new Error(`Migration for batch ${batchId} is already in progress`);
    }
    this._activeLocks.add(lockKey);

    const activeMigrationId = `mig_batch_${Date.now()}_${uuidv4().substring(0, 8)}`;
    let auditLog = null;

    try {
      // 1. Fetch Batch from Firestore
      const batchDoc = await db.collection('batches').doc(batchId).get();
      if (!batchDoc.exists) {
        const existingBatch = await ArchivedBatch.findOne({ batchId });
        if (existingBatch) {
          console.log(`[ARCHIVE] Batch ${batchId} is already migrated to MongoDB and pruned from Firestore.`);
          auditLog.status = 'COMPLETED';
          auditLog.verificationPassed = true;
          auditLog.firestorePruned = true;
          auditLog.completedAt = new Date();
          await auditLog.save().catch(() => {});
          return {
            success: true,
            migrationId: activeMigrationId,
            batchId,
            name: existingBatch.name,
            migratedStudentsCount: existingBatch.completedStudentsCount,
            verified: true,
            alreadyArchived: true,
          };
        }
        throw new Error(`Batch ${batchId} not found in Firestore`);
      }
      const bData = batchDoc.data();

      // 2. Create Audit Log
      auditLog = await MigrationAuditLog.create({
        migrationId: activeMigrationId,
        type: 'batch',
        targetId: batchId,
        targetName: bData.name || 'Batch',
        adminUid,
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      });

      // 3. Find all students belonging to this batch
      let studentDocs = [];
      const assignedIds = bData.assignedStudentIds || [];

      if (assignedIds.length > 0) {
        const promises = assignedIds.map((uid) => db.collection('students').doc(uid).get());
        const snaps = await Promise.all(promises);
        studentDocs = snaps.filter((s) => s.exists);
      } else {
        const snap = await db
          .collection('students')
          .where('batchId', '==', batchId)
          .get();
        if (!snap.empty) {
          studentDocs = snap.docs;
        } else {
          const nameSnap = await db
            .collection('students')
            .where('batch', '==', bData.name)
            .get();
          studentDocs = nameSnap.docs;
        }
      }

      auditLog.studentCount = studentDocs.length;
      auditLog.studentUids = studentDocs.map((d) => d.id);
      await auditLog.save();

      // 4. Migrate each student sequentially with safety checks
      const migratedStudents = [];
      const failedStudents = [];

      for (const doc of studentDocs) {
        try {
          const res = await this.migrateStudent({
            studentUid: doc.id,
            adminUid,
            force,
            migrationId: activeMigrationId,
          });
          migratedStudents.push(res);
        } catch (sErr) {
          console.error(`[BATCH MIGRATION] Failed student ${doc.id}:`, sErr.message);
          failedStudents.push({ studentUid: doc.id, error: sErr.message });
        }
      }

      if (failedStudents.length > 0 && !force) {
        throw new Error(
          `Batch migration partially failed: ${failedStudents.length} student(s) failed out of ${studentDocs.length}`
        );
      }

      // 5. Compile and Upsert ArchivedBatch in MongoDB
      const batchChecksum = this.calculateChecksum({
        batchId,
        code: bData.code || '',
        name: bData.name || '',
        course: bData.course || '',
        studentCount: migratedStudents.length,
      });

      const archivedBatchPayload = {
        batchId,
        code: bData.code || '',
        name: bData.name || '',
        course: bData.course || '',
        timeSlot: bData.timeSlot || '',
        days: bData.days || [],
        trainer: bData.trainer || '',
        labRoom: bData.labRoom || '',
        capacity: Number(bData.capacity || 0),
        startDate: bData.startDate || '',
        endDate: bData.endDate || this.getTodayIST(),
        status: 'Archived',
        completedStudentsCount: migratedStudents.length,
        studentUids: migratedStudents.map((s) => s.studentUid),
        assignedStudentIds: bData.assignedStudentIds || [],
        attendanceSummary: {
          totalSessions: Number(bData.totalSessions || 0),
          averageAttendancePct: Number(bData.averageAttendancePct || 0),
        },
        originalSnapshot: bData,
        migrationMetadata: {
          migratedAt: new Date(),
          migratedBy: adminUid,
          migrationId: activeMigrationId,
          checksum: batchChecksum,
        },
      };

      await ArchivedBatch.findOneAndUpdate(
        { batchId },
        archivedBatchPayload,
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );

      // Verify batch in MongoDB
      const verifyBatch = await ArchivedBatch.findOne({ batchId });
      if (!verifyBatch) {
        throw new Error(`Data integrity verification failed for batch ${batchId} in MongoDB`);
      }

      // 6. Complete Firestore Purge for Batch: Delete all batch-related records from Firestore
      // a) Clean up attendance sessions and session records
      try {
        const sessionsSnap = await db.collection('batches').doc(batchId).collection('attendance_sessions').get().catch(() => ({ docs: [] }));
        for (const sessionDoc of sessionsSnap.docs || []) {
          const recordsSnap = await sessionDoc.ref.collection('records').get().catch(() => ({ docs: [] }));
          const sBatch = db.batch();
          (recordsSnap.docs || []).forEach((r) => sBatch.delete(r.ref));
          sBatch.delete(sessionDoc.ref);
          await sBatch.commit();
        }
      } catch (sessErr) {
        console.warn(`[ARCHIVE] Warning cleaning up attendance sessions for batch ${batchId}:`, sessErr.message);
      }

      // b) Clean up batch attendance records from root 'attendance' collection
      try {
        const [attByBatchIdSnap, attByBatchNameSnap] = await Promise.all([
          db.collection('attendance').where('batchId', '==', batchId).get().catch(() => ({ docs: [] })),
          bData.name
            ? db.collection('attendance').where('batch', '==', bData.name).get().catch(() => ({ docs: [] }))
            : Promise.resolve({ docs: [] }),
        ]);
        const attBatch = db.batch();
        const seenAttDocIds = new Set();
        [...(attByBatchIdSnap.docs || []), ...(attByBatchNameSnap.docs || [])].forEach((d) => {
          if (!seenAttDocIds.has(d.id)) {
            seenAttDocIds.add(d.id);
            attBatch.delete(d.ref);
          }
        });
        await attBatch.commit();
      } catch (attErr) {
        console.warn(`[ARCHIVE] Warning cleaning up attendance records for batch ${batchId}:`, attErr.message);
      }

      // c) Clean up batch schedules / timetables
      try {
        const [schedByIdSnap, schedByNameSnap] = await Promise.all([
          db.collection('schedules').where('batchId', '==', batchId).get().catch(() => ({ docs: [] })),
          bData.name
            ? db.collection('schedules').where('batch', '==', bData.name).get().catch(() => ({ docs: [] }))
            : Promise.resolve({ docs: [] }),
        ]);
        const schedBatch = db.batch();
        const seenSchedIds = new Set();
        [...(schedByIdSnap.docs || []), ...(schedByNameSnap.docs || [])].forEach((d) => {
          if (!seenSchedIds.has(d.id)) {
            seenSchedIds.add(d.id);
            schedBatch.delete(d.ref);
          }
        });
        await schedBatch.commit();
      } catch (schedErr) {
        console.warn(`[ARCHIVE] Warning cleaning up schedules for batch ${batchId}:`, schedErr.message);
      }

      // d) CRITICAL: Scoped Test / Exam Cleanup
      // Delete ONLY batch-wise tests created specifically for this batch.
      // NEVER delete tests that are for "All Batches" (targetType == 'all') or tests assigned to other batches!
      let prunedBatchTestsCount = 0;
      try {
        const testsSnap = await db.collection('tests').get().catch(() => ({ docs: [] }));
        for (const testDoc of testsSnap.docs || []) {
          const tData = testDoc.data();
          const targetType = (tData.targetType || 'all').toLowerCase();

          // RULE 1: If test is created for ALL batches (targetType == 'all'), DO NOT DELETE!
          if (targetType === 'all') {
            continue;
          }

          // RULE 2: If test targetType == 'batch', check if it matches THIS batch
          const testBatch = tData.batch || tData.batchName || '';
          const testBatchId = tData.batchId || '';
          const targetBatches = Array.isArray(tData.targetBatches) ? tData.targetBatches : [];

          const matchesThisBatch =
            testBatch === bData.name ||
            testBatch === batchId ||
            testBatchId === batchId ||
            targetBatches.includes(batchId) ||
            targetBatches.includes(bData.name);

          if (!matchesThisBatch) {
            // This test belongs to another batch, DO NOT DELETE!
            continue;
          }

          // If test targets MULTIPLE batches, do not delete the test; only remove this batch from targetBatches
          if (targetBatches.length > 1) {
            const remaining = targetBatches.filter((b) => b !== batchId && b !== bData.name);
            await testDoc.ref.update({
              targetBatches: remaining,
              updatedAt: new Date().toISOString(),
            });
            console.log(`[ARCHIVE] Disassociated batch ${batchId} from multi-batch test ${testDoc.id}. Test preserved for remaining batches.`);
            continue;
          }

          // Test is exclusively for THIS batch: delete test document and all its submissions
          const submissionsSnap = await db.collection('test_submissions').where('testId', '==', testDoc.id).get().catch(() => ({ docs: [] }));
          const testPruneBatch = db.batch();
          (submissionsSnap.docs || []).forEach((sub) => testPruneBatch.delete(sub.ref));
          testPruneBatch.delete(testDoc.ref);
          await testPruneBatch.commit();
          prunedBatchTestsCount++;
          console.log(`[ARCHIVE] Pruned batch-wise test ${testDoc.id} (${tData.title || ''}) and ${submissionsSnap.docs.length} submissions for batch ${batchId}.`);
        }
      } catch (testErr) {
        console.warn(`[ARCHIVE] Warning during scoped test cleanup for batch ${batchId}:`, testErr.message);
      }

      // e) Delete Batch document in Firestore completely
      await db.collection('batches').doc(batchId).delete();

      // 7. Complete Audit Log
      auditLog.verificationPassed = true;
      auditLog.firestorePruned = true;
      auditLog.status = 'COMPLETED';
      auditLog.completedAt = new Date();
      auditLog.details = {
        batchId,
        batchName: bData.name,
        migratedCount: migratedStudents.length,
        failedCount: failedStudents.length,
        prunedBatchTestsCount,
      };
      await auditLog.save();

      console.log(`[ARCHIVE SUCCESS] Batch ${batchId} (${bData.name}) archived to MongoDB successfully.`);
      return {
        success: true,
        migrationId: activeMigrationId,
        batchId,
        batchName: bData.name,
        migratedStudentsCount: migratedStudents.length,
        failedStudentsCount: failedStudents.length,
        verified: true,
      };
    } catch (err) {
      console.error(`[BATCH ARCHIVE ERROR] Failed to archive batch ${batchId}:`, err.message);
      if (auditLog) {
        auditLog.status = 'FAILED';
        auditLog.error = err.message;
        auditLog.completedAt = new Date();
        await auditLog.save().catch(() => {});
      }
      throw err;
    } finally {
      this._activeLocks.delete(lockKey);
    }
  }

  // ==========================================================================
  // PERMANENT ARCHIVE ENFORCEMENT (NO ROLLBACK)
  // ==========================================================================

  /**
   * Rollback is intentionally permanently disabled as requested to preserve maximum Firestore storage reduction
   */
  static async rollbackMigration() {
    throw new Error(
      'Rollback is permanently disabled. Operational records have been pruned from Cloud Firestore to optimize database storage. All student and batch transcripts are preserved in MongoDB cold storage.'
    );
  }

  // ==========================================================================
  // ARCHIVE QUERY SERVICES
  // ==========================================================================

  /**
   * Get paginated completed students from MongoDB with search and filtering
   */
  static async getArchivedStudents({ page = 1, limit = 20, search = '', course = '', batchId = '' } = {}) {
    await connectMongo();

    const query = {};
    if (search && search.trim()) {
      const s = search.trim();
      query.$or = [
        { name: { $regex: s, $options: 'i' } },
        { studentId: { $regex: s, $options: 'i' } },
        { phone: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
      ];
    }
    if (course && course.trim()) {
      query.course = course.trim();
    }
    if (batchId && batchId.trim()) {
      query.batchId = batchId.trim();
    }

    const skip = (Math.max(1, page) - 1) * limit;
    const [docs, total] = await Promise.all([
      ArchivedStudent.find(query)
        .sort({ completionDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ArchivedStudent.countDocuments(query),
    ]);

    return {
      students: docs,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single completed student full dossier by studentUid, studentId, or email
   */
  static async getArchivedStudentDetails(studentUid, studentId = null, email = null) {
    await connectMongo();

    const orClauses = [];
    if (studentUid) orClauses.push({ studentUid });
    if (studentId) {
      orClauses.push({ studentId: studentId.toUpperCase() }, { studentId });
    }
    if (email) {
      orClauses.push({ internalEmail: email.toLowerCase() }, { email: email.toLowerCase() });
    }

    if (orClauses.length === 0) {
      throw new Error('Student identifier is required to fetch archived record');
    }

    const student = await ArchivedStudent.findOne({ $or: orClauses }).lean();
    if (!student) {
      throw new Error(`Archived student record not found for: ${studentUid || studentId || email}`);
    }
    return student;
  }

  /**
   * Get paginated archived batches from MongoDB
   */
  static async getArchivedBatches({ page = 1, limit = 20, search = '' } = {}) {
    await connectMongo();

    const query = {};
    if (search && search.trim()) {
      const s = search.trim();
      query.$or = [
        { name: { $regex: s, $options: 'i' } },
        { code: { $regex: s, $options: 'i' } },
        { course: { $regex: s, $options: 'i' } },
      ];
    }

    const skip = (Math.max(1, page) - 1) * limit;
    const [docs, total] = await Promise.all([
      ArchivedBatch.find(query)
        .sort({ endDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ArchivedBatch.countDocuments(query),
    ]);

    return {
      batches: docs,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single archived batch details
   */
  static async getArchivedBatchDetails(batchId) {
    if (!batchId) throw new Error('batchId is required');
    await connectMongo();

    const batch = await ArchivedBatch.findOne({ batchId }).lean();
    if (!batch) {
      throw new Error(`Archived batch record not found for batchId: ${batchId}`);
    }

    // Also fetch students who graduated from this batch
    const students = await ArchivedStudent.find({ batchId })
      .select('studentUid studentId name phone course completionDate status feeSummary')
      .lean();

    return {
      ...batch,
      graduatedStudents: students,
    };
  }

  /**
   * Get migration audit logs
   */
  static async getMigrationAuditLogs({ page = 1, limit = 20 } = {}) {
    await connectMongo();
    const skip = (Math.max(1, page) - 1) * limit;
    const [logs, total] = await Promise.all([
      MigrationAuditLog.find()
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      MigrationAuditLog.countDocuments(),
    ]);

    return {
      logs,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    };
  }
}

module.exports = ArchiveMigrationService;
