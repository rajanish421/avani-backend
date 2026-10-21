const express = require('express');
const router = express.Router();
const studentRegistrationService = require('../services/studentRegistrationService');
const studentAuthService = require('../services/studentAuthService');
const { verifyAdminAuth } = require('../middleware/auth');

/**
 * Admin: Register Student (Idempotent, Sequential ID, Firebase Admin Auth & Firestore)
 * POST /api/students/register
 * Server-side operation: Allocates atomic student IDs via Firestore transaction,
 * enforces batch capacity limits, and provisions student Auth via Firebase Admin SDK.
 */
router.post('/register', verifyAdminAuth, async (req, res, next) => {
  try {
    const result = await studentRegistrationService.registerStudent(req.adminUser, req.body);
    return res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Admin: Check Registration Status by requestId
 * GET /api/students/registration-status/:requestId
 * Allows the admin registration wizard to resume or verify status on network retry.
 */
router.get('/registration-status/:requestId', verifyAdminAuth, async (req, res, next) => {
  try {
    const status = await studentRegistrationService.getRegistrationStatus(req.params.requestId);
    if (!status.found) {
      return res.status(404).json({ error: 'Registration request not found.' });
    }
    return res.status(200).json(status);
  } catch (error) {
    next(error);
  }
});

/**
 * Admin: Reconcile uncertain or interrupted registration
 * POST /api/students/reconcile-registration/:requestId
 */
router.post('/reconcile-registration/:requestId', verifyAdminAuth, async (req, res, next) => {
  try {
    const result = await studentRegistrationService.reconcileRegistration(req.params.requestId);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Admin: Reset student password (Temporary or Permanent privacy mode)
 * POST /api/students/admin-reset-password
 * Server-side operation: Uses Firebase Admin SDK (auth.updateUser) to change password,
 * revokes active refresh tokens (auth.revokeRefreshTokens), and increments sessionVersion in Firestore.
 */
router.post('/admin-reset-password', verifyAdminAuth, async (req, res, next) => {
  try {
    const { studentUid, studentId, newPassword, isTemporary } = req.body;
    const result = await studentAuthService.adminResetPassword(req.adminUser, {
      studentUid,
      studentId,
      newPassword,
      isTemporary: isTemporary === true,
    });
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
