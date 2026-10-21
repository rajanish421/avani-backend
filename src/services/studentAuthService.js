const { db, auth, FieldValue } = require('../config/firebase');

class StudentAuthService {
  /**
   * Admin: Reset student password (either temporary or permanent privacy-shielded).
   * This is strictly a server-side operation requiring Firebase Admin SDK credentials.
   * Invalidates active mobile/web sessions and optionally forces password change on next login.
   */
  async adminResetPassword(adminUser, { studentUid, studentId, newPassword, isTemporary = false }) {
    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 6) {
      const err = new Error('Password must be at least 6 characters long.');
      err.statusCode = 400;
      throw err;
    }

    if (!studentUid && !studentId) {
      const err = new Error('Either studentUid or studentId is required.');
      err.statusCode = 400;
      throw err;
    }

    let uid = studentUid ? studentUid.trim() : null;
    let normStudentId = studentId ? studentId.trim().toUpperCase() : null;

    // Resolve UID and studentId from lookup table if needed
    if (!uid && normStudentId) {
      const lookupDoc = await db.collection('student_id_lookup').doc(normStudentId).get();
      if (!lookupDoc.exists) {
        const err = new Error(`Student with ID "${normStudentId}" not found.`);
        err.statusCode = 404;
        throw err;
      }
      uid = lookupDoc.data().uid;
    } else if (uid && !normStudentId) {
      const studentDoc = await db.collection('students').doc(uid).get();
      if (studentDoc.exists) {
        const sData = studentDoc.data() || {};
        normStudentId = (sData.studentId || sData.student_id || sData.rollNo || '').toUpperCase();
      }
    }

    if (!uid) {
      const err = new Error('Could not resolve student account UID.');
      err.statusCode = 404;
      throw err;
    }

    // 1. Update password in Firebase Auth via Admin SDK with retry for transient network timeouts
    let updateSuccess = false;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await auth.updateUser(uid, {
          password: newPassword,
        });
        updateSuccess = true;
        break;
      } catch (authErr) {
        lastError = authErr;
        if (attempt < 3 && authErr.message && authErr.message.includes('timeout')) {
          await new Promise((res) => setTimeout(res, 1500));
          continue;
        }
        break;
      }
    }

    if (!updateSuccess) {
      const err = new Error(lastError?.message || 'Failed to update student password in Firebase Auth.');
      err.statusCode = 400;
      throw err;
    }

    // 2. Invalidate all active mobile/web sessions for this student account via Admin SDK
    try {
      await auth.revokeRefreshTokens(uid);
    } catch (revokeErr) {
      console.warn(`[AUTH] Notice: Could not revoke refresh tokens for student ${uid}:`, revokeErr.message);
    }

    // 3. Update Firestore records with mustChangePassword flag and session version
    const mustChange = Boolean(isTemporary);
    const batch = db.batch();

    const studentRef = db.collection('students').doc(uid);
    const studentDoc = await studentRef.get();
    if (studentDoc.exists) {
      batch.update(studentRef, {
        mustChangePassword: mustChange,
        passwordResetByAdmin: true,
        resetByAdminEmail: adminUser?.email || 'admin',
        passwordResetAt: FieldValue.serverTimestamp(),
        forceSessionRelogin: true,
        sessionVersion: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (!normStudentId) {
        const sData = studentDoc.data() || {};
        normStudentId = (sData.studentId || sData.student_id || '').toUpperCase();
      }
    }

    if (normStudentId) {
      const lookupRef = db.collection('student_id_lookup').doc(normStudentId);
      const lookupDoc = await lookupRef.get();
      if (lookupDoc.exists) {
        batch.update(lookupRef, {
          mustChangePassword: mustChange,
          passwordResetAt: FieldValue.serverTimestamp(),
          sessionVersion: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    await batch.commit();

    return {
      success: true,
      message: mustChange
        ? 'Temporary password set successfully. Student must change it upon their next login.'
        : 'Password updated permanently. Student can log in immediately with their new password.',
      studentId: normStudentId,
      uid: uid,
      mustChangePassword: mustChange,
    };
  }
}

module.exports = new StudentAuthService();
