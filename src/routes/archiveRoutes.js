const express = require('express');
const router = express.Router();
const ArchiveMigrationService = require('../services/archiveMigrationService');
const { verifyAdminAuth, verifyStudentAuth } = require('../middleware/auth');

// ============================================================================
// STUDENT ALUMNI ENDPOINTS (Authenticated Student Access)
// ============================================================================

/**
 * GET /api/archive/student/my-record
 * Fetches the calling student's completed academic/fee/certificate archive from MongoDB
 */
router.get('/student/my-record', verifyStudentAuth, async (req, res, next) => {
  try {
    const studentUid = req.studentUser?.uid;
    if (!studentUid) {
      return res.status(401).json({ error: 'Unauthorized: Student identifier missing from session.' });
    }

    const archiveData = await ArchiveMigrationService.getArchivedStudentDetails(studentUid);
    res.status(200).json({
      success: true,
      data: archiveData,
    });
  } catch (err) {
    if (err.message && err.message.includes('not found')) {
      return res.status(404).json({ error: 'No archived record found for your account.' });
    }
    next(err);
  }
});

// ============================================================================
// ADMIN MIGRATION & ARCHIVE MANAGEMENT (Requires Admin Token)
// ============================================================================

/**
 * GET & POST /api/archive/student/:studentUid/preview
 * Pre-flight audit before archiving a single student
 */
const handleStudentPreview = async (req, res, next) => {
  try {
    const { studentUid } = req.params;
    const preview = await ArchiveMigrationService.previewStudentMigration(studentUid);
    res.status(200).json({
      success: true,
      data: preview,
    });
  } catch (err) {
    next(err);
  }
};
router.get('/student/:studentUid/preview', verifyAdminAuth, handleStudentPreview);
router.post('/student/:studentUid/preview', verifyAdminAuth, handleStudentPreview);

/**
 * POST /api/archive/student/:studentUid/execute
 * Migrate a single completed student to MongoDB and prune Firestore operational records
 */
router.post('/student/:studentUid/execute', verifyAdminAuth, async (req, res, next) => {
  try {
    const { studentUid } = req.params;
    const force = Boolean(req.body?.force);
    const adminUid = req.adminUser?.uid || 'admin';

    const result = await ArchiveMigrationService.migrateStudent({
      studentUid,
      adminUid,
      force,
    });

    res.status(200).json({
      success: true,
      message: `Student ${result.studentId} migrated to MongoDB archive successfully.`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET & POST /api/archive/batch/:batchId/preview
 * Pre-flight audit before archiving an entire batch
 */
const handleBatchPreview = async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const preview = await ArchiveMigrationService.previewBatchMigration(batchId);
    res.status(200).json({
      success: true,
      data: preview,
    });
  } catch (err) {
    next(err);
  }
};
router.get('/batch/:batchId/preview', verifyAdminAuth, handleBatchPreview);
router.post('/batch/:batchId/preview', verifyAdminAuth, handleBatchPreview);

/**
 * POST /api/archive/batch/:batchId/execute
 * Migrate an entire batch and its students to MongoDB and prune Firestore records
 */
router.post('/batch/:batchId/execute', verifyAdminAuth, async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const force = Boolean(req.body?.force);
    const adminUid = req.adminUser?.uid || 'admin';

    const result = await ArchiveMigrationService.migrateBatch({
      batchId,
      adminUid,
      force,
    });

    res.status(200).json({
      success: true,
      message: `Batch ${result.batchName} and ${result.migratedStudentsCount} students archived to MongoDB successfully.`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/archive/rollback/:migrationId
 * Restore archived student and batch records to active state in Firestore
 */
router.post('/rollback/:migrationId', verifyAdminAuth, async (req, res, next) => {
  try {
    const { migrationId } = req.params;
    const adminUid = req.adminUser?.uid || 'admin';

    const result = await ArchiveMigrationService.rollbackMigration({
      migrationId,
      adminUid,
    });

    res.status(200).json({
      success: true,
      message: `Migration ${migrationId} rolled back successfully.`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/archive/students
 * Paginated query of completed students in MongoDB
 */
router.get('/students', verifyAdminAuth, async (req, res, next) => {
  try {
    const { page, limit, search, course, batchId } = req.query;
    const result = await ArchiveMigrationService.getArchivedStudents({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search: search || '',
      course: course || '',
      batchId: batchId || '',
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/archive/students/:studentUid
 * Fetch full archived dossier for admin inspection
 */
router.get('/students/:studentUid', verifyAdminAuth, async (req, res, next) => {
  try {
    const { studentUid } = req.params;
    const student = await ArchiveMigrationService.getArchivedStudentDetails(studentUid);
    res.status(200).json({
      success: true,
      data: student,
    });
  } catch (err) {
    if (err.message && err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/archive/batches
 * Paginated query of archived batches in MongoDB
 */
router.get('/batches', verifyAdminAuth, async (req, res, next) => {
  try {
    const { page, limit, search } = req.query;
    const result = await ArchiveMigrationService.getArchivedBatches({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search: search || '',
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/archive/batches/:batchId
 * Fetch full archived batch details
 */
router.get('/batches/:batchId', verifyAdminAuth, async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const batch = await ArchiveMigrationService.getArchivedBatchDetails(batchId);
    res.status(200).json({
      success: true,
      data: batch,
    });
  } catch (err) {
    if (err.message && err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/archive/logs
 * Migration audit trail
 */
router.get('/logs', verifyAdminAuth, async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await ArchiveMigrationService.getMigrationAuditLogs({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
