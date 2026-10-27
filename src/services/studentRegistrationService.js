const crypto = require('crypto');
const { db, auth, FieldValue } = require('../config/firebase');
const instituteConfig = require('../config/institute');
const { generatePasswordFromDOB } = require('../utils/passwordGenerator');
const { validateRegistrationPayload } = require('../utils/validators');

class StudentRegistrationService {
  /**
   * Main idempotent registration workflow
   */
  async registerStudent(adminUser, payload) {
    // 1. Validation
    const errors = validateRegistrationPayload(payload);
    if (errors.length > 0) {
      const err = new Error(errors.join(', '));
      err.statusCode = 400;
      throw err;
    }

    const {
      requestId,
      name,
      registrationNo,
      dob,
      course,
      batch = '',
      admissionDate,
      totalFee = 0,
      downPayment = 0,
      fatherName = '',
      motherName = '',
      phone = '',
      email = '',
      category = 'General',
      gender = 'Male',
      address = '',
      parentPhone = '',
      photoUrl = '',
      isInstallmentPlan = false,
      installmentsCount = 1,
      installmentFrequency = 'Monthly (Every 30 Days)',
      installments = [],
      feeBreakdown = null,
      concessionReason = '',
      examInstallments = [],
      instituteShortCode,
    } = payload;

    const shortCode = (instituteShortCode || instituteConfig.shortCode || 'ACI').trim().toUpperCase();

    // 2. Generate temporary password from DOB in DDMMYYYY format
    const tempPassword = generatePasswordFromDOB(dob);

    const normRegNo = registrationNo.trim().toUpperCase();
    const reqRef = db.collection('registration_requests').doc(requestId);

    // 3. Check existing request record for idempotency
    const reqSnap = await reqRef.get();
    let predeterminedUid;
    let internalEmail;

    if (reqSnap.exists) {
      const reqData = reqSnap.data();

      // If already completed, return idempotent response immediately
      if (reqData.status === 'COMPLETED') {
        const studentSnap = await db.collection('students').doc(reqData.uid).get();
        return {
          success: true,
          idempotent: true,
          message: 'Student registration already completed successfully.',
          studentId: reqData.studentId,
          registrationNo: reqData.registrationNo,
          uid: reqData.uid,
          tempPassword: reqData.tempPassword || tempPassword,
          mustChangePassword: true,
          student: studentSnap.exists ? studentSnap.data() : null,
        };
      }

      // If previously prepared or auth created, reuse predetermined UID
      predeterminedUid = reqData.uid;
      internalEmail = reqData.internalEmail;
    } else {
      // Generate predetermined unique UID
      const randomSlug = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      predeterminedUid = `stu_${randomSlug}`;
      internalEmail = instituteConfig.buildInternalEmail(predeterminedUid);

      // Record initial request state
      await reqRef.set({
        requestId,
        uid: predeterminedUid,
        internalEmail,
        registrationNo: normRegNo,
        dob: (dob || '').trim(),
        status: 'PREPARING',
        adminUid: adminUser?.uid || 'admin',
        adminEmail: adminUser?.email || '',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // 4. Create or reuse Firebase Auth account with predetermined UID & internal email alias
    let authUserExists = false;
    try {
      await auth.getUser(predeterminedUid);
      authUserExists = true;
    } catch (authGetErr) {
      if (authGetErr.code !== 'auth/user-not-found') {
        throw authGetErr;
      }
    }

    if (!authUserExists) {
      try {
        await auth.createUser({
          uid: predeterminedUid,
          email: internalEmail,
          password: tempPassword,
          displayName: name.trim(),
        });
      } catch (authCreateErr) {
        // If email already in use or error, check if recoverable
        if (authCreateErr.code === 'auth/email-already-exists') {
          const userByEmail = await auth.getUserByEmail(internalEmail);
          predeterminedUid = userByEmail.uid;
        } else {
          await reqRef.update({
            status: 'FAILED',
            error: authCreateErr.message,
            updatedAt: FieldValue.serverTimestamp(),
          }).catch(() => {});
          throw authCreateErr;
        }
      }
    }

    // Update request state to AUTH_CREATED
    await reqRef.update({
      status: 'AUTH_CREATED',
      uid: predeterminedUid,
      internalEmail,
      tempPassword,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 5. Final Atomic Firestore Transaction
    // Assigns student ID, writes student, enrollment, fees, lookup and updates counter
    // Uses isolated counter for tests to prevent burning production student sequences
    const counterDocId = (process.env.NODE_ENV === 'test' || process.env.IS_TEST)
      ? 'student_id_test'
      : 'student_id';
    const counterRef = db.collection('system_counters').doc(counterDocId);
    const studentRef = db.collection('students').doc(predeterminedUid);
    const enrollmentRef = db.collection('enrollments').doc(`enr_${predeterminedUid}`);
    const feeAccountRef = db.collection('fee_accounts').doc(`fee_${predeterminedUid}`);

    // Look up batch doc if provided
    let batchRef = null;
    if (batch && typeof batch === 'string') {
      try {
        const bDoc = await db.collection('batches').doc(batch).get();
        if (bDoc.exists) {
          batchRef = bDoc.ref;
        } else {
          const qSnap = await db.collection('batches').where('name', '==', batch).limit(1).get();
          if (!qSnap.empty) {
            batchRef = qSnap.docs[0].ref;
          }
        }
      } catch (bErr) {
        console.warn('[REGISTRATION] Could not resolve batch reference:', bErr.message);
      }
    }

    let finalResult;
    try {
      finalResult = await db.runTransaction(async (transaction) => {
        // A. Read request to ensure not raced/completed
        const currentReqDoc = await transaction.get(reqRef);
        if (currentReqDoc.exists && currentReqDoc.data().status === 'COMPLETED') {
          return currentReqDoc.data();
        }

        // Read batch doc if exists & enforce capacity
        let currentBatchDoc = null;
        if (batchRef) {
          currentBatchDoc = await transaction.get(batchRef);
          if (currentBatchDoc && currentBatchDoc.exists) {
            const currentBatchData = currentBatchDoc.data() || {};
            const capacity = Number(currentBatchData.capacity) || 0;
            const assigned = Array.isArray(currentBatchData.assignedStudentIds) ? currentBatchData.assignedStudentIds : [];
            const curEnrolled = Math.max(Number(currentBatchData.enrolled) || 0, assigned.length);
            if (capacity > 0 && curEnrolled >= capacity) {
              const capError = new Error(`Batch "${currentBatchData.name || batch}" has reached full capacity (${curEnrolled}/${capacity} seats filled). Please select another batch or increase its capacity.`);
              capError.statusCode = 400;
              capError.code = 'BATCH_CAPACITY_FULL';
              throw capError;
            }
          }
        }

        // B. Read & increment sequence counter
        const counterDoc = await transaction.get(counterRef);
        let currentCounter = 0;
        if (counterDoc.exists) {
          currentCounter = counterDoc.data().currentValue || 0;
        }
        const nextCounter = currentCounter + 1;
        const studentId = instituteConfig.formatStudentId(nextCounter, shortCode);

        // D. Check student ID lookup collision
        const lookupRef = db.collection('student_id_lookup').doc(studentId);
        const lookupDoc = await transaction.get(lookupRef);
        if (lookupDoc.exists && lookupDoc.data().uid !== predeterminedUid) {
          throw new Error(`Counter conflict: Student ID ${studentId} is already allocated.`);
        }

        const totalNum = Number.isFinite(Number(totalFee)) ? Number(totalFee) : 0;
        const paidNum = Number.isFinite(Number(downPayment)) ? Number(downPayment) : 0;
        const pendingNum = Math.max(0, totalNum - paidNum);

        // E. Student Record Data
        const studentData = {
          id: predeterminedUid,
          uid: predeterminedUid,
          studentId,
          rollNo: studentId,
          registrationNo: normRegNo,
          dob: (dob || '').trim(),
          name: name.trim(),
          fatherName: fatherName.trim(),
          motherName: motherName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          category,
          gender,
          address: address.trim(),
          parentPhone: parentPhone.trim(),
          guardianPhone: parentPhone.trim(),
          course,
          batch,
          admissionDate,
          totalFees: totalNum,
          paidFees: paidNum,
          pendingFees: pendingNum,
          status: 'Active',
          avatarUrl: photoUrl || '',
          mustChangePassword: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };

        // Fee components calculation
        const parsedFeeBreakdown = (feeBreakdown && typeof feeBreakdown === 'object') ? feeBreakdown : {};
        const admFee = Number(parsedFeeBreakdown.admissionFee) || 0;
        const totalExamFee = Number(parsedFeeBreakdown.totalExamFee) || 0;
        const otherFee = Number(parsedFeeBreakdown.otherFee) || 0;
        const tuitionFee = Number(parsedFeeBreakdown.tuitionFee) || Math.max(0, totalNum - admFee - totalExamFee - otherFee);

        // Calculate exam fee paid from examInstallments payload if provided
        let examFeePaid = 0;
        if (Array.isArray(examInstallments)) {
          for (const ex of examInstallments) {
            if (ex && (String(ex.status).toLowerCase() === 'paid')) {
              examFeePaid += Number(ex.amount) || 0;
            }
          }
        }
        if (Number.isFinite(Number(parsedFeeBreakdown.examFeePaid))) {
          examFeePaid = Math.max(examFeePaid, Number(parsedFeeBreakdown.examFeePaid));
        }

        const admissionPaid = Math.min(paidNum, admFee);
        const remPaid = Math.max(0, paidNum - admissionPaid - examFeePaid);
        const tuitionPaid = Math.min(tuitionFee, remPaid);

        studentData.admissionFee = admFee;
        studentData.admissionPaid = admissionPaid;
        studentData.admissionPending = Math.max(0, admFee - admissionPaid);
        studentData.tuitionFee = tuitionFee;
        studentData.tuitionPaid = tuitionPaid;
        studentData.tuitionPending = Math.max(0, tuitionFee - tuitionPaid);
        studentData.totalExamFee = totalExamFee;
        studentData.examFeePaid = examFeePaid;
        studentData.examFeePending = Math.max(0, totalExamFee - examFeePaid);
        studentData.otherFee = otherFee;
        studentData.otherFeePaid = 0;
        studentData.otherFeePending = otherFee;
        studentData.concessionDiscount = Number(parsedFeeBreakdown.concessionDiscount) || 0;
        studentData.concessionReason = concessionReason || parsedFeeBreakdown.concessionReason || '';
        studentData.feeBreakdown = {
          admissionFee: admFee,
          tuitionFee,
          numberOfExams: Number(parsedFeeBreakdown.numberOfExams) || 0,
          examFeePerExam: Number(parsedFeeBreakdown.examFeePerExam) || 0,
          totalExamFee,
          otherFee,
          standardTotal: Number(parsedFeeBreakdown.standardTotal) || totalNum,
          concessionDiscount: Number(parsedFeeBreakdown.concessionDiscount) || 0,
          concessionType: parsedFeeBreakdown.concessionType || 'None',
          concessionReason: concessionReason || parsedFeeBreakdown.concessionReason || '',
          finalApplicableFee: totalNum,
        };

        // F. Enrollment Record Data
        const enrollmentData = {
          id: `enr_${predeterminedUid}`,
          studentId,
          studentUid: predeterminedUid,
          studentName: name.trim(),
          course,
          batch,
          admissionDate,
          status: 'Active',
          enrolledAt: FieldValue.serverTimestamp(),
        };

        // G. Fee Account Data
        const nowReceiptSuffix = Date.now().toString().slice(-7);
        const admissionReceiptNo = `REC-ADM-${studentId}-${nowReceiptSuffix}`;

        const feeAccountData = {
          id: `fee_${predeterminedUid}`,
          studentId,
          studentUid: predeterminedUid,
          totalFee: totalNum,
          paidFee: paidNum,
          pendingFee: pendingNum,
          admissionFee: admFee,
          admissionPaid,
          admissionPending: Math.max(0, admFee - admissionPaid),
          tuitionFee,
          tuitionPaid,
          tuitionPending: Math.max(0, tuitionFee - tuitionPaid),
          totalExamFee,
          examFeePaid,
          examFeePending: Math.max(0, totalExamFee - examFeePaid),
          otherFee,
          otherFeePaid: 0,
          otherFeePending: otherFee,
          feeBreakdown: studentData.feeBreakdown,
          isInstallmentPlan: Boolean(isInstallmentPlan),
          installmentsCount: Number(installmentsCount),
          installmentFrequency,
          installments: Array.isArray(installments) ? installments : [],
          examInstallments: Array.isArray(examInstallments) ? examInstallments : [],
          status: pendingNum === 0 ? 'Fully Paid' : 'Active',
          lastPaymentAmount: paidNum > 0 ? paidNum : 0,
          lastReceiptNo: paidNum > 0 ? admissionReceiptNo : null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };

        // If down payment made at registration, create verified fee receipt atomically
        if (paidNum > 0) {
          const paymentRef = db.collection('fee_payments').doc();
          const nowFormatted = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
          const paymentRecord = {
            id: paymentRef.id,
            studentUid: predeterminedUid,
            studentName: name.trim(),
            studentRoll: studentId,
            courseName: course,
            batchName: batch,
            installmentNumber: 1,
            installmentTitle: paidNum >= totalNum ? 'Full Course Fee Payment' : 'Admission Fee / Down Payment',
            amount: paidNum,
            paymentDate: nowFormatted,
            paymentMode: 'Cash',
            transactionId: `ADM-${nowReceiptSuffix}`,
            receiptNo: admissionReceiptNo,
            status: 'Approved',
            feeCategory: paidNum >= totalNum ? 'Tuition Installment' : 'Admission Fee',
            concessionReason: concessionReason || parsedFeeBreakdown.concessionReason || '',
            remarks: 'Recorded at student admission down payment',
            collectedBy: 'Admin',
            createdAt: FieldValue.serverTimestamp(),
          };
          transaction.set(paymentRef, paymentRecord);
        }

        // H. Student ID Lookup (for student login)
        const deterministicEmail = `${studentId.toLowerCase()}@${instituteConfig.internalEmailDomain}`;
        const lookupData = {
          studentId,
          uid: predeterminedUid,
          internalEmail: deterministicEmail,
          status: 'Active',
          mustChangePassword: true,
          createdAt: FieldValue.serverTimestamp(),
        };

        // I. Atomic Writes
        transaction.set(studentRef, { ...studentData, internalEmail: deterministicEmail });
        transaction.set(enrollmentRef, enrollmentData);
        transaction.set(feeAccountRef, feeAccountData);
        transaction.set(lookupRef, lookupData);
        transaction.set(counterRef, {
          currentValue: nextCounter,
          prefix: shortCode,
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(reqRef, {
          requestId,
          uid: predeterminedUid,
          studentId,
          registrationNo: normRegNo,
          dob: (dob || '').trim(),
          tempPassword,
          status: 'COMPLETED',
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // K. Update Batch Enrollment if batch exists
        if (batchRef && currentBatchDoc && currentBatchDoc.exists) {
          const currentBatchData = currentBatchDoc.data() || {};
          const assigned = Array.isArray(currentBatchData.assignedStudentIds) ? currentBatchData.assignedStudentIds : [];
          if (!assigned.includes(studentId)) {
            const updatedAssigned = [...assigned, studentId];
            transaction.update(batchRef, {
              assignedStudentIds: updatedAssigned,
              enrolled: updatedAssigned.length,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
        }

        return {
          studentId,
          registrationNo: normRegNo,
          uid: predeterminedUid,
          tempPassword,
          mustChangePassword: true,
          student: studentData,
        };
      });
    } catch (txError) {
      // Definitive failure cleanup
      if (txError.statusCode === 409 || txError.statusCode === 400 || txError.code === 'BATCH_CAPACITY_FULL') {
        // Clean up partial Auth account if created
        try {
          await auth.deleteUser(predeterminedUid);
        } catch (_) {}
        await reqRef.update({
          status: 'FAILED',
          error: txError.message,
          errorCode: txError.code || (txError.statusCode === 400 ? 'VALIDATION_FAILED' : 'REGISTRATION_FAILED'),
          updatedAt: FieldValue.serverTimestamp(),
        }).catch(() => {});
      }
      throw txError;
    }

    // Synchronize Firebase Auth user email to deterministic alias:
    // e.g. aci00001@students.avani.internal so student app can log in directly via Firebase Flutter SDK
    const deterministicEmail = `${finalResult.studentId.toLowerCase()}@${instituteConfig.internalEmailDomain}`;
    try {
      await auth.updateUser(predeterminedUid, {
        email: deterministicEmail,
      });
      await reqRef.update({
        internalEmail: deterministicEmail,
        updatedAt: FieldValue.serverTimestamp(),
      }).catch(() => {});
    } catch (emailSyncErr) {
      console.warn('[REGISTRATION] Warning syncing Auth email to deterministic alias:', emailSyncErr.message);
    }

    return {
      success: true,
      message: 'Student registered successfully.',
      studentId: finalResult.studentId,
      registrationNo: finalResult.registrationNo,
      uid: finalResult.uid,
      tempPassword,
      mustChangePassword: true,
      student: finalResult.student,
    };
  }

  /**
   * Status check for recovery / resume
   */
  async getRegistrationStatus(requestId) {
    if (!requestId) {
      const err = new Error('requestId is required');
      err.statusCode = 400;
      throw err;
    }

    const doc = await db.collection('registration_requests').doc(requestId).get();
    if (!doc.exists) {
      return { found: false, status: 'NOT_FOUND' };
    }

    const data = doc.data();
    let studentData = null;
    if (data.status === 'COMPLETED' && data.uid) {
      const sDoc = await db.collection('students').doc(data.uid).get();
      if (sDoc.exists) {
        studentData = sDoc.data();
      }
    }

    return {
      found: true,
      status: data.status,
      requestId: data.requestId,
      studentId: data.studentId || null,
      registrationNo: data.registrationNo || null,
      uid: data.uid || null,
      tempPassword: data.tempPassword || null,
      mustChangePassword: true,
      student: studentData,
      completedAt: data.completedAt || null,
      error: data.error || null,
    };
  }

  /**
   * Reconcile interrupted or uncertain registration
   */
  async reconcileRegistration(requestId) {
    const status = await this.getRegistrationStatus(requestId);
    if (!status.found) {
      return { reconciled: false, message: 'Request not found.' };
    }

    if (status.status === 'COMPLETED') {
      return {
        reconciled: true,
        action: 'NONE',
        message: 'Registration was already completed successfully.',
        data: status,
      };
    }

    if (status.status === 'AUTH_CREATED') {
      // Safe state: Auth exists, Firestore transaction can be resumed or retried
      return {
        reconciled: true,
        action: 'READY_TO_COMPLETE',
        message: 'Auth account exists. Client can retry submission to finalize transaction.',
        uid: status.uid,
      };
    }

    return {
      reconciled: true,
      status: status.status,
      message: `Registration is in state: ${status.status}`,
    };
  }
}

module.exports = new StudentRegistrationService();
