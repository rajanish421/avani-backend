const express = require('express');
const router = express.Router();
const FcmNotificationService = require('../services/fcmNotificationService');
const DailyGreetingsService = require('../services/dailyGreetingsService');
const { db, FieldValue } = require('../config/firebase');

/**
 * POST /api/notifications/save-token
 * Body: { studentUid, token }
 */
router.post('/save-token', async (req, res, next) => {
  try {
    const { studentUid, token } = req.body;
    if (!studentUid || !token) {
      return res.status(400).json({ error: 'studentUid and token are required' });
    }
    const result = await FcmNotificationService.saveStudentToken(studentUid, token);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/fee-due
 * Trigger: When a student has fee due
 * Body: { studentUid, studentName, amount, pendingFees, dueDate, courseName }
 */
router.post('/fee-due', async (req, res, next) => {
  try {
    const { studentUid, studentName, amount, pendingFees, dueDate, courseName } = req.body;
    const finalAmount = amount !== undefined ? amount : pendingFees;
    if (!studentUid || finalAmount === undefined) {
      return res.status(400).json({ error: 'studentUid and amount are required' });
    }
    const result = await FcmNotificationService.sendFeeDueNotification({
      studentUid,
      studentName,
      amount: finalAmount,
      dueDate,
      courseName,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/fee-reminder
 * Trigger: Admin manually clicks "Send Fee Reminder" for a student
 * Body: { studentUid, studentName, amount, pendingFees, courseName, customNote, message }
 */
router.post('/fee-reminder', async (req, res, next) => {
  try {
    const { studentUid, studentName, amount, pendingFees, courseName, customNote, message } = req.body;
    if (!studentUid) {
      return res.status(400).json({ error: 'studentUid is required' });
    }
    const finalAmount = amount !== undefined ? amount : pendingFees;
    const finalNote = customNote !== undefined ? customNote : message;
    const result = await FcmNotificationService.sendFeeReminderNotification({
      studentUid,
      studentName,
      amount: finalAmount,
      courseName,
      customNote: finalNote,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/test
 * Trigger: When test is scheduled or made live
 * Body: { testId, testTitle, subject, date, examDate, time, startTime, totalMarks, targetType, targetBatchId, batchId, targetBatchName, batchName, isLive }
 */
router.post('/test', async (req, res, next) => {
  try {
    const {
      testId,
      testTitle,
      subject,
      date,
      examDate,
      time,
      startTime,
      totalMarks,
      targetType,
      targetBatchId,
      batchId,
      targetBatchName,
      batchName,
      isLive,
    } = req.body;

    if (!testId || !testTitle) {
      return res.status(400).json({ error: 'testId and testTitle are required' });
    }

    const finalDate = date || examDate || '';
    const finalTime = time || startTime || '';
    const finalBatchId = targetBatchId || batchId || '';
    const finalBatchName = targetBatchName || batchName || '';

    const result = await FcmNotificationService.sendTestNotification({
      testId,
      testTitle,
      subject,
      date: finalDate,
      time: finalTime,
      totalMarks: totalMarks || 0,
      targetType: targetType || (finalBatchId ? 'Specific Batch' : 'All Students'),
      targetBatchId: finalBatchId,
      targetBatchName: finalBatchName,
      isLive: Boolean(isLive),
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/class-rescheduled
 * Trigger: When admin reschedules or cancels a batch class
 * Body: { batchId, batchName, subject, date, originalTime, originalTimeSlot, newTime, rescheduledTimeSlot, isCancelled, type, reason }
 */
router.post('/class-rescheduled', async (req, res, next) => {
  try {
    const {
      batchId,
      batchName,
      subject,
      date,
      originalTime,
      originalTimeSlot,
      newTime,
      rescheduledTimeSlot,
      isCancelled,
      type,
      reason,
    } = req.body;

    if (!batchId) {
      return res.status(400).json({ error: 'batchId is required' });
    }

    const finalOriginalTime = originalTime || originalTimeSlot || '';
    const finalNewTime = newTime || rescheduledTimeSlot || '';
    const finalIsCancelled =
      isCancelled !== undefined
        ? Boolean(isCancelled)
        : String(type || '').toLowerCase().includes('cancel');

    const result = await FcmNotificationService.sendClassRescheduledNotification({
      batchId,
      batchName,
      subject,
      date,
      originalTime: finalOriginalTime,
      newTime: finalNewTime,
      isCancelled: finalIsCancelled,
      reason: reason || '',
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/payment-verification
 * Trigger: When admin approves or rejects a student self-submitted fee payment
 * Body: { studentUid, studentName, amount, transactionId, isApproved, reason }
 */
router.post('/payment-verification', async (req, res, next) => {
  try {
    const { studentUid, studentName, amount, transactionId, isApproved, status, reason } = req.body;
    if (!studentUid) {
      return res.status(400).json({ error: 'studentUid is required' });
    }
    const approved = isApproved !== undefined ? Boolean(isApproved) : status === 'Approved';
    const result = await FcmNotificationService.sendPaymentVerificationNotification({
      studentUid,
      studentName,
      amount,
      transactionId,
      isApproved: approved,
      reason,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/low-attendance
 * Trigger: When student's attendance drops below 75%
 * Body: { studentUid, studentName, attendancePct, conducted, attended, batchName }
 */
router.post('/low-attendance', async (req, res, next) => {
  try {
    const { studentUid, studentName, attendancePct, conducted, attended, batchName } = req.body;
    if (!studentUid || attendancePct === undefined) {
      return res.status(400).json({ error: 'studentUid and attendancePct are required' });
    }
    const result = await FcmNotificationService.sendLowAttendanceNotification({
      studentUid,
      studentName,
      attendancePct,
      conducted: conducted || 0,
      attended: attended || 0,
      batchName: batchName || '',
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/announcement
 * Trigger: When admin broadcasts an announcement (to All Students, Specific Batch, or Specific Student)
 * Body: { title, message, category, priority, targetType, targetBatchId, batchId, targetBatchName, batchName, targetCourseId, courseId, targetCourseName, courseName, studentUid, announcementId }
 */
router.post('/announcement', async (req, res, next) => {
  try {
    const {
      title,
      message,
      category,
      priority,
      targetType,
      targetBatchId,
      batchId,
      targetBatchName,
      batchName,
      targetCourseId,
      courseId,
      targetCourseName,
      courseName,
      studentUid,
      announcementId,
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'title and message are required' });
    }

    const finalBatchId = targetBatchId || batchId || '';
    const finalBatchName = targetBatchName || batchName || '';
    const finalCourseId = targetCourseId || courseId || '';
    const finalCourseName = targetCourseName || courseName || '';

    const result = await FcmNotificationService.sendAnnouncementNotification({
      title,
      message,
      category,
      priority,
      targetType: targetType || (finalBatchId ? 'Specific Batch' : 'All Students'),
      targetBatchId: finalBatchId,
      targetBatchName: finalBatchName,
      targetCourseId: finalCourseId,
      targetCourseName: finalCourseName,
      studentUid: studentUid || '',
      announcementId: announcementId || '',
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/festival-wish
 * Trigger: When admin broadcasts festival wishes or institute holiday notices
 * Body: { title, message, festivalName, category }
 */
router.post('/festival-wish', async (req, res, next) => {
  try {
    const { title, message, festivalName, category } = req.body;
    const result = await FcmNotificationService.sendFestivalWishNotification({
      title,
      message,
      festivalName,
      category,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/birthday-wish
 * Trigger: Send birthday wish directly and strictly to a specific student
 * Body: { studentUid, studentName, customMessage }
 */
router.post('/birthday-wish', async (req, res, next) => {
  try {
    const { studentUid, studentName, customMessage } = req.body;
    if (!studentUid) {
      return res.status(400).json({ error: 'studentUid is required for birthday wish' });
    }
    const result = await FcmNotificationService.sendBirthdayWishNotification({
      studentUid,
      studentName,
      customMessage,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET & POST /api/notifications/trigger-daily-greetings
 * Trigger: Automated morning external cron (cron-job.org / UptimeRobot) or manual dispatch of festival & birthday wishes
 * Query or Body: { date, force }
 */
const handleDailyGreetingsTrigger = async (req, res, next) => {
  try {
    const date = req.query.date || (req.body && req.body.date) || null;
    const force = req.query.force === 'true' || Boolean(req.body && req.body.force);
    const result = await DailyGreetingsService.checkAndTriggerGreetings({
      date,
      force,
    });
    // Ultra-compact response for cron monitoring services (avoids output size limit errors)
    res.status(200).json({
      status: 'ok',
      date: result.date,
      festival: result.festival ? (result.festival.sent ? 'sent' : result.festival.reason || 'skipped') : 'none',
      birthdaysSent: (result.birthdays || []).filter(b => b.sent).length,
    });
  } catch (err) {
    next(err);
  }
};

router.get('/trigger-daily-greetings', handleDailyGreetingsTrigger);
router.post('/trigger-daily-greetings', handleDailyGreetingsTrigger);

/**
 * GET /api/notifications/student/:studentUid
 * Fetch all notifications relevant to this student (personal + batch + all)
 */
router.get('/student/:studentUid', async (req, res, next) => {
  try {
    const { studentUid } = req.params;
    if (!studentUid) {
      return res.status(400).json({ error: 'studentUid is required' });
    }

    // Retrieve student profile to get batchId
    const studentDoc = await db.collection('students').doc(studentUid).get();
    const studentData = studentDoc.exists ? studentDoc.data() : {};
    const batchId = studentData.batchId || '';

    const snapshot = await db
      .collection('notifications')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const notifications = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const isForStudent =
        data.targetType === 'All Students' ||
        (data.targetType === 'Specific Student' && data.studentUid === studentUid) ||
        (data.targetType === 'Specific Batch' && batchId && data.targetBatchId === batchId);

      if (isForStudent) {
        notifications.push({
          id: doc.id,
          ...data,
          isRead: Array.isArray(data.readBy) && data.readBy.includes(studentUid),
        });
      }
    });

    res.status(200).json({ success: true, count: notifications.length, notifications });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/:id/mark-read
 * Body: { studentUid }
 */
router.post('/:id/mark-read', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { studentUid } = req.body;
    if (!studentUid) {
      return res.status(400).json({ error: 'studentUid is required' });
    }

    await db.collection('notifications').doc(id).update({
      readBy: FieldValue.arrayUnion(studentUid),
    });

    res.status(200).json({ success: true, notificationId: id, studentUid });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/cleanup-expired
 * Trigger: Purges notifications older than 30 days (or custom days)
 * Body: { days } (default 30)
 */
router.post('/cleanup-expired', async (req, res, next) => {
  try {
    const days = req.body?.days ? Number(req.body.days) : 30;
    const result = await FcmNotificationService.cleanExpiredNotifications(days);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
