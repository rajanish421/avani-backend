const { db, messaging, FieldValue } = require('../config/firebase');

class FcmNotificationService {
  /**
   * Helper to clean topic string according to FCM rules: [a-zA-Z0-9-_.~%]+
   */
  static sanitizeTopic(topic) {
    if (!topic) return 'all_students';
    return String(topic).replace(/[^a-zA-Z0-9-_.~%]/g, '_');
  }

  /**
   * Save or update student FCM device token in Firestore
   */
  static async saveStudentToken(studentUid, token) {
    if (!studentUid || !token) {
      throw new Error('studentUid and token are required');
    }

    const studentRef = db.collection('students').doc(studentUid);
    const doc = await studentRef.get();

    if (!doc.exists) {
      throw new Error(`Student with UID ${studentUid} not found`);
    }

    await studentRef.set(
      {
        fcmToken: token,
        fcmTokens: FieldValue.arrayUnion(token),
        tokenUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { success: true, studentUid, tokenSaved: true };
  }

  /**
   * Record notification into Firestore `/notifications` collection for in-app history
   */
  static async recordInFirestore({
    studentUid = null,
    targetType = 'All Students',
    targetBatchId = null,
    targetBatchName = null,
    title,
    body,
    type,
    metadata = {},
  }) {
    try {
      const notifRef = db.collection('notifications').doc();
      const notifData = {
        id: notifRef.id,
        title,
        message: body,
        type, // 'fee_due', 'fee_reminder', 'test_live', 'test_upcoming', 'class_rescheduled', 'class_cancelled', 'festival_wish', 'announcement', 'payment_verified', 'payment_rejected'
        targetType, // 'Specific Student', 'Specific Batch', 'All Students'
        studentUid: studentUid || '',
        targetBatchId: targetBatchId || '',
        targetBatchName: targetBatchName || (metadata && (metadata.targetBatchName || metadata.batchName)) || '',
        metadata: metadata || {},
        createdAt: FieldValue.serverTimestamp(),
        read: false,
        readBy: [],
      };
      await notifRef.set(notifData);
      return notifRef.id;
    } catch (err) {
      console.warn('[FCM SERVICE] Could not record notification in Firestore:', err.message);
      return null;
    }
  }

  /**
   * Send push notification directly to a device token
   */
  static async sendToToken(token, { title, body, data = {}, type = 'general' }) {
    if (!messaging) {
      console.warn('[FCM SERVICE] Messaging service not initialized; skipping live FCM dispatch.');
      return { success: false, reason: 'MESSAGING_NOT_INITIALIZED' };
    }

    if (!token) {
      return { success: false, reason: 'TOKEN_MISSING' };
    }

    const payload = {
      token: token.trim(),
      notification: {
        title,
        body,
      },
      data: {
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])
        ),
        type,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'institute_high_importance_channel',
          icon: 'ic_notification',
          color: '#0B3B8B',
          sound: 'default',
          priority: 'max',
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            contentAvailable: true,
          },
        },
      },
    };

    try {
      const response = await messaging.send(payload);
      return { success: true, messageId: response };
    } catch (error) {
      console.error('[FCM SERVICE] Failed to send push to token:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send push notification to a topic (e.g. `all_students`, `batch_{batchId}`)
   */
  static async sendToTopic(topic, { title, body, data = {}, type = 'general' }) {
    if (!messaging) {
      console.warn('[FCM SERVICE] Messaging service not initialized; skipping live FCM dispatch.');
      return { success: false, reason: 'MESSAGING_NOT_INITIALIZED' };
    }

    const cleanTopic = this.sanitizeTopic(topic);
    const payload = {
      topic: cleanTopic,
      notification: {
        title,
        body,
      },
      data: {
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])
        ),
        type,
        topic: cleanTopic,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'institute_high_importance_channel',
          icon: 'ic_notification',
          color: '#0B3B8B',
          sound: 'default',
          priority: 'max',
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            contentAvailable: true,
          },
        },
      },
    };

    try {
      const response = await messaging.send(payload);
      return { success: true, topic: cleanTopic, messageId: response };
    } catch (error) {
      console.error(`[FCM SERVICE] Failed to send to topic ${cleanTopic}:`, error.message);
      return { success: false, topic: cleanTopic, error: error.message };
    }
  }

  /**
   * 1. Fee is Due Notification (Specific Student)
   */
  static async sendFeeDueNotification({ studentUid, studentName, amount, dueDate, courseName }) {
    if (!studentUid) throw new Error('studentUid is required for fee due notification');

    const formattedAmount = Number(amount || 0).toLocaleString('en-IN');
    const title = '🔔 Fee Payment Due Reminder';
    const body = `Dear ${studentName || 'Student'}, your installment of ₹${formattedAmount} for ${courseName || 'your course'} is due on ${dueDate || 'upcoming due date'}. Please pay online via the app to avoid late charges.`;

    const metadata = {
      studentUid,
      amount: String(amount),
      dueDate: String(dueDate || ''),
      courseName: String(courseName || ''),
      route: '/fees',
    };

    // 1. Record in Firestore
    const notifId = await this.recordInFirestore({
      studentUid,
      targetType: 'Specific Student',
      title,
      body,
      type: 'fee_due',
      metadata,
    });

    // 2. Fetch student's FCM token
    let fcmResult = { success: false, reason: 'NO_TOKEN' };
    try {
      const doc = await db.collection('students').doc(studentUid).get();
      if (doc.exists) {
        const token = doc.data().fcmToken;
        if (token) {
          fcmResult = await this.sendToToken(token, {
            title,
            body,
            data: metadata,
            type: 'fee_due',
          });
        }
      }
    } catch (err) {
      console.warn('[FCM SERVICE] Student token fetch error:', err.message);
    }

    return {
      success: true,
      notificationId: notifId,
      fcm: fcmResult,
      title,
      body,
    };
  }

  /**
   * 2. Upcoming / Live CBT Test Notification (Specific Batch or All Students)
   */
  static async sendTestNotification({
    testId,
    testTitle,
    subject = '',
    date = '',
    time = '',
    totalMarks = 0,
    targetType = 'All Students',
    targetBatchId = '',
    targetBatchName = '',
    isLive = false,
  }) {
    if (!testId || !testTitle) {
      throw new Error('testId and testTitle are required for test notification');
    }

    let title;
    let body;

    if (isLive) {
      title = `🚨 Exam is Now LIVE: ${testTitle}`;
      body = `${testTitle}${subject ? ' (' + subject + ')' : ''} is active and ready to attempt. Click to start your examination now!`;
    } else {
      title = `📝 Upcoming Exam: ${testTitle}`;
      body = `${testTitle}${subject ? ' for ' + subject : ''} is scheduled on ${date || 'soon'} at ${time || ''}. Total Marks: ${totalMarks}. Please prepare well.`;
    }

    const isBatchTarget =
      targetType === 'Specific Batch' ||
      targetType === 'batch' ||
      (targetBatchId && targetType !== 'All Students' && targetType !== 'all');

    const effectiveTargetType = isBatchTarget ? 'Specific Batch' : 'All Students';
    const effectiveBatchId = isBatchTarget ? (targetBatchId || targetBatchName) : '';

    const type = isLive ? 'test_live' : 'test_upcoming';
    const metadata = {
      testId: String(testId),
      testTitle,
      subject,
      targetType: effectiveTargetType,
      targetBatchId: effectiveBatchId,
      targetBatchName: targetBatchName || '',
      isLive: String(isLive),
      route: '/tests',
    };

    // 1. Record in Firestore
    const notifId = await this.recordInFirestore({
      targetType: effectiveTargetType,
      targetBatchId: effectiveBatchId,
      targetBatchName: targetBatchName || '',
      title,
      body,
      type,
      metadata,
    });

    // 2. Determine target topic
    let topicName;
    if (isBatchTarget && effectiveBatchId) {
      topicName = `batch_${this.sanitizeTopic(effectiveBatchId)}`;
    } else {
      topicName = 'all_students';
    }

    const fcmResult = await this.sendToTopic(topicName, {
      title,
      body,
      data: metadata,
      type,
    });

    // If targetBatchName is also provided and differs from batchId, also dispatch to ensure delivery
    if (
      isBatchTarget &&
      targetBatchName &&
      this.sanitizeTopic(targetBatchName) !== this.sanitizeTopic(effectiveBatchId)
    ) {
      await this.sendToTopic(`batch_${this.sanitizeTopic(targetBatchName)}`, {
        title,
        body,
        data: metadata,
        type,
      });
    }

    return {
      success: true,
      notificationId: notifId,
      targetTopic: topicName,
      fcm: fcmResult,
      title,
      body,
    };
  }

  /**
   * 3. Admin Send Fee Reminder (For a specific student)
   */
  static async sendFeeReminderNotification({
    studentUid,
    studentName,
    amount,
    courseName,
    customNote,
  }) {
    if (!studentUid) throw new Error('studentUid is required for fee reminder');

    const formattedAmount = Number(amount || 0).toLocaleString('en-IN');
    const title = '📢 Fee Reminder from Admin Office';
    const body =
      customNote && customNote.trim().length > 0
        ? customNote.trim()
        : `Dear ${studentName || 'Student'}, you have an outstanding fee balance of ₹${formattedAmount} for ${courseName || 'your course'}. Please clear it at your earliest convenience.`;

    const metadata = {
      studentUid,
      amount: String(amount),
      courseName: String(courseName || ''),
      route: '/fees',
    };

    // 1. Record in Firestore
    const notifId = await this.recordInFirestore({
      studentUid,
      targetType: 'Specific Student',
      title,
      body,
      type: 'fee_reminder',
      metadata,
    });

    // 2. Also record in `/fee_reminders`
    try {
      await db.collection('fee_reminders').add({
        studentUid,
        studentName: studentName || '',
        amount: Number(amount) || 0,
        courseName: courseName || '',
        note: body,
        sentAt: FieldValue.serverTimestamp(),
      });
    } catch (_) {}

    // 3. Dispatch FCM Push
    let fcmResult = { success: false, reason: 'NO_TOKEN' };
    try {
      const doc = await db.collection('students').doc(studentUid).get();
      if (doc.exists) {
        const token = doc.data().fcmToken;
        if (token) {
          fcmResult = await this.sendToToken(token, {
            title,
            body,
            data: metadata,
            type: 'fee_reminder',
          });
        }
      }
    } catch (err) {
      console.warn('[FCM SERVICE] Student token fetch error:', err.message);
    }

    return {
      success: true,
      notificationId: notifId,
      fcm: fcmResult,
      title,
      body,
    };
  }

  /**
   * 4. Class Cancelled / Rescheduled Notification (Specific Batch)
   */
  static async sendClassRescheduledNotification({
    batchId,
    batchName,
    subject = '',
    date = '',
    originalTime = '',
    newTime = '',
    isCancelled = false,
    reason = '',
  }) {
    if (!batchId) throw new Error('batchId is required for timetable notifications');

    let title;
    let body;

    if (isCancelled) {
      title = `⚠️ Class Cancelled: ${batchName || 'Your Batch'}`;
      body = `${subject ? subject + ' class' : 'Class'} on ${date || 'today'} has been cancelled.${reason ? ' Reason: ' + reason : ' Please review your updated timetable.'}`;
    } else {
      title = `🗓️ Class Rescheduled: ${batchName || 'Your Batch'}`;
      const timeChange = originalTime ? ` from ${originalTime} to ${newTime}` : ` to ${newTime}`;
      body = `Notice: ${subject ? subject + ' class' : 'Class'} on ${date || 'today'} has been rescheduled${timeChange}.${reason ? ' (' + reason + ')' : ''} Please be on time.`;
    }

    const type = isCancelled ? 'class_cancelled' : 'class_rescheduled';
    const metadata = {
      batchId: String(batchId),
      batchName: batchName || '',
      subject,
      date,
      newTime,
      isCancelled: String(isCancelled),
      route: '/timetable',
    };

    // 1. Record in Firestore
    const notifId = await this.recordInFirestore({
      targetType: 'Specific Batch',
      targetBatchId: batchId,
      targetBatchName: batchName || '',
      title,
      body,
      type,
      metadata: {
        ...metadata,
        targetBatchId: batchId,
        targetBatchName: batchName || '',
      },
    });

    // 2. Dispatch to batch topic
    const topicName = `batch_${this.sanitizeTopic(batchId)}`;
    const fcmResult = await this.sendToTopic(topicName, {
      title,
      body,
      data: metadata,
      type,
    });

    // If batchName is also provided and differs from batchId, also dispatch to that topic
    if (batchName && this.sanitizeTopic(batchName) !== this.sanitizeTopic(batchId)) {
      await this.sendToTopic(`batch_${this.sanitizeTopic(batchName)}`, {
        title,
        body,
        data: metadata,
        type,
      });
    }

    return {
      success: true,
      notificationId: notifId,
      targetTopic: topicName,
      fcm: fcmResult,
      title,
      body,
    };
  }

  /**
   * 5. Festival Wish / General Broadcast Notification (All Students)
   */
  static async sendFestivalWishNotification({
    title,
    message,
    festivalName = '',
    category = 'Holiday',
  }) {
    const finalTitle =
      title && title.trim().length > 0
        ? title.trim()
        : `✨ Happy ${festivalName || 'Festive Season'}! - Avani Computer Institute`;

    const finalBody =
      message && message.trim().length > 0
        ? message.trim()
        : `Warm wishes to all our students and their families on the occasion of ${festivalName || 'the festival'}. May this season bring joy, success, and prosperity!`;

    const type = 'festival_wish';
    const metadata = {
      festivalName,
      category,
      route: '/notifications',
    };

    // 1. Record in Firestore
    const notifId = await this.recordInFirestore({
      targetType: 'All Students',
      title: finalTitle,
      body: finalBody,
      type,
      metadata,
    });

    // 2. Also record in /admin_notifications for Admin Dashboard
    try {
      await db.collection('admin_notifications').add({
        type: 'festival_wish',
        title: finalTitle,
        message: finalBody,
        festivalName,
        category,
        isRead: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (_) {}

    // 3. Dispatch to `all_students` topic
    const fcmResult = await this.sendToTopic('all_students', {
      title: finalTitle,
      body: finalBody,
      data: metadata,
      type,
    });

    // 4. Also dispatch to `admin` topic
    try {
      await this.sendToTopic('admin', {
        title: finalTitle,
        body: finalBody,
        data: metadata,
        type,
      });
    } catch (_) {}

    return {
      success: true,
      notificationId: notifId,
      targetTopic: 'all_students',
      fcm: fcmResult,
      title: finalTitle,
      body: finalBody,
    };
  }

  /**
   * 5b. Send Personalized Birthday Wish Notification strictly to a specific student
   */
  static async sendBirthdayWishNotification({
    studentUid,
    studentName,
    customMessage = '',
  }) {
    if (!studentUid) throw new Error('studentUid is required for birthday wish notification');

    const displayName = studentName || 'Student';
    const title = `🎂 Happy Birthday, ${displayName}! 🎉`;
    const body =
      customMessage && customMessage.trim().length > 0
        ? customMessage.trim()
        : `Dear ${displayName}, Avani Computer Institute wishes you a very Happy Birthday! 🌟 May this year bring you immense success, happiness, and bright achievements in your studies. Have a wonderful day!`;

    const type = 'birthday_wish';
    const metadata = {
      studentUid,
      route: '/notifications',
    };

    // 1. Record in Firestore /notifications strictly for this specific student
    const notifId = await this.recordInFirestore({
      studentUid,
      targetType: 'Specific Student',
      title,
      body,
      type,
      metadata,
    });

    // 2. Dispatch FCM Push strictly to student's device token
    let fcmResult = { success: false, reason: 'NO_TOKEN' };
    try {
      const doc = await db.collection('students').doc(studentUid).get();
      if (doc.exists) {
        const studentData = doc.data();
        const token = studentData.fcmToken;
        if (token) {
          fcmResult = await this.sendToToken(token, {
            title,
            body,
            data: metadata,
            type,
          });
        }
      }
    } catch (err) {
      console.warn('[FCM SERVICE] Student token fetch error for birthday wish:', err.message);
    }

    return {
      success: true,
      notificationId: notifId,
      studentUid,
      fcm: fcmResult,
      title,
      body,
    };
  }

  /**
   * 6. Payment Verification Done Notification (Specific Student)
   */
  static async sendPaymentVerificationNotification({
    studentUid,
    studentName,
    amount,
    transactionId = '',
    isApproved = true,
    reason = '',
  }) {
    if (!studentUid) throw new Error('studentUid is required for payment verification notification');

    const formattedAmount = Number(amount || 0).toLocaleString('en-IN');
    const title = isApproved ? '✅ Payment Approved & Verified' : '❌ Payment Verification Update';
    const body = isApproved
      ? `Dear ${studentName || 'Student'}, your fee payment of ₹${formattedAmount}${transactionId ? ' (UTR: ' + transactionId + ')' : ''} has been successfully verified and approved.`
      : `Dear ${studentName || 'Student'}, your payment submission of ₹${formattedAmount} could not be verified.${reason ? ' Reason: ' + reason : ' Please check your submission or contact the admin office.'}`;

    const type = isApproved ? 'payment_verified' : 'payment_rejected';
    const metadata = {
      studentUid,
      amount: String(amount || ''),
      transactionId: String(transactionId || ''),
      isApproved: String(isApproved),
      route: '/fees',
    };

    // 1. Record in Firestore
    const notifId = await this.recordInFirestore({
      studentUid,
      targetType: 'Specific Student',
      title,
      body,
      type,
      metadata,
    });

    // 2. Dispatch FCM Push
    let fcmResult = { success: false, reason: 'NO_TOKEN' };
    try {
      const doc = await db.collection('students').doc(studentUid).get();
      if (doc.exists) {
        const token = doc.data().fcmToken;
        if (token) {
          fcmResult = await this.sendToToken(token, {
            title,
            body,
            data: metadata,
            type,
          });
        }
      }
    } catch (err) {
      console.warn('[FCM SERVICE] Student token fetch error:', err.message);
    }

    return {
      success: true,
      notificationId: notifId,
      fcm: fcmResult,
      title,
      body,
    };
  }

  /**
   * 7. Low Attendance Alert Notification (<75%) (Specific Student)
   */
  static async sendLowAttendanceNotification({
    studentUid,
    studentName,
    attendancePct,
    conducted = 0,
    attended = 0,
    batchName = '',
  }) {
    if (!studentUid) throw new Error('studentUid is required for low attendance notification');

    const title = `⚠️ Low Attendance Warning (${attendancePct}%)`;
    const body = `Dear ${studentName || 'Student'}, your attendance in ${batchName || 'your batch'} has dropped to ${attendancePct}%, which is below the mandatory 75% threshold (${attended}/${conducted} sessions attended). Please attend classes regularly to maintain exam eligibility.`;

    const type = 'low_attendance';
    const metadata = {
      studentUid,
      attendancePct: String(attendancePct),
      conducted: String(conducted),
      attended: String(attended),
      batchName: String(batchName || ''),
      route: '/attendance-report',
    };

    // 1. Record in Firestore
    const notifId = await this.recordInFirestore({
      studentUid,
      targetType: 'Specific Student',
      title,
      body,
      type,
      metadata,
    });

    // 2. Dispatch FCM Push
    let fcmResult = { success: false, reason: 'NO_TOKEN' };
    try {
      const doc = await db.collection('students').doc(studentUid).get();
      if (doc.exists) {
        const token = doc.data().fcmToken;
        if (token) {
          fcmResult = await this.sendToToken(token, {
            title,
            body,
            data: metadata,
            type,
          });
        }
      }
    } catch (err) {
      console.warn('[FCM SERVICE] Student token fetch error:', err.message);
    }

    return {
      success: true,
      notificationId: notifId,
      fcm: fcmResult,
      title,
      body,
    };
  }

  /**
   * 8. Announcement Notification (Conditional: All Students, Specific Batch, Specific Course, or Specific Student)
   */
  static async sendAnnouncementNotification({
    title,
    message,
    category = 'General',
    priority = 'Normal',
    targetType = 'All Students',
    targetBatchId = '',
    targetBatchName = '',
    targetCourseId = '',
    targetCourseName = '',
    studentUid = '',
    announcementId = '',
  }) {
    if (!title || !message) {
      throw new Error('title and message are required for announcement notification');
    }

    const cleanTargetType = (targetType || 'All Students').trim();
    let mappedType = 'announcement';
    let route = '/notifications';

    const catLower = (category || '').toLowerCase();
    if (catLower.includes('exam') || catLower.includes('test')) {
      mappedType = 'test_upcoming';
      route = '/tests';
    } else if (catLower.includes('fee')) {
      mappedType = 'fee_reminder';
      route = '/fees';
    } else if (catLower.includes('class') || catLower.includes('schedule')) {
      mappedType = 'class_rescheduled';
      route = '/timetable';
    } else if (catLower.includes('holiday') || catLower.includes('festival')) {
      mappedType = 'festival_wish';
      route = '/notifications';
    }

    const metadata = {
      announcementId: String(announcementId || ''),
      category: String(category || 'General'),
      priority: String(priority || 'Normal'),
      targetType: cleanTargetType,
      targetBatchId: String(targetBatchId || ''),
      targetBatchName: String(targetBatchName || ''),
      targetCourseId: String(targetCourseId || ''),
      targetCourseName: String(targetCourseName || ''),
      studentUid: String(studentUid || ''),
      route,
    };

    // 1. Record in Firestore `/notifications`
    const notifId = await this.recordInFirestore({
      studentUid: studentUid || null,
      targetType: cleanTargetType,
      targetBatchId: targetBatchId || null,
      targetBatchName: targetBatchName || null,
      title,
      body: message,
      type: mappedType,
      metadata,
    });

    // 2. Dispatch FCM Push according to strict target condition
    let fcmResult = { success: false, reason: 'NO_DISPATCH' };
    const lowerType = cleanTargetType.toLowerCase();

    if ((lowerType === 'specific student' || lowerType === 'student') && studentUid) {
      // Strictly to specific student device
      try {
        const doc = await db.collection('students').doc(studentUid).get();
        if (doc.exists && doc.data().fcmToken) {
          fcmResult = await this.sendToToken(doc.data().fcmToken, {
            title,
            body: message,
            data: metadata,
            type: mappedType,
          });
        }
      } catch (err) {
        console.warn('[FCM SERVICE] Student token fetch error:', err.message);
      }
    } else if (
      (lowerType === 'specific batch' || lowerType === 'batch') &&
      (targetBatchId || targetBatchName)
    ) {
      // Strictly to specific batch students
      const batchKey = targetBatchId || targetBatchName;
      const topicName = `batch_${this.sanitizeTopic(batchKey)}`;
      fcmResult = await this.sendToTopic(topicName, {
        title,
        body: message,
        data: metadata,
        type: mappedType,
      });

      if (
        targetBatchName &&
        this.sanitizeTopic(targetBatchName) !== this.sanitizeTopic(batchKey)
      ) {
        await this.sendToTopic(`batch_${this.sanitizeTopic(targetBatchName)}`, {
          title,
          body: message,
          data: metadata,
          type: mappedType,
        });
      }
    } else {
      // Broadcast to all students
      fcmResult = await this.sendToTopic('all_students', {
        title,
        body: message,
        data: metadata,
        type: mappedType,
      });
    }

    return {
      success: true,
      notificationId: notifId,
      targetType: cleanTargetType,
      fcm: fcmResult,
      title,
      body: message,
    };
  }

  /**
   * Delete notifications older than specified days (default 30 days)
   * Ensures that expired notifications are automatically cleaned up and permanently removed.
   */
  static async cleanExpiredNotifications(expirationDays = 30) {
    const days = Number(expirationDays) || 30;
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let totalDeleted = 0;

    try {
      // 1. Clean notifications collection matching Timestamp
      const notifSnapshot = await db
        .collection('notifications')
        .where('createdAt', '<', cutoffDate)
        .limit(500)
        .get();

      if (!notifSnapshot.empty) {
        const batch = db.batch();
        notifSnapshot.forEach((doc) => {
          batch.delete(doc.ref);
          totalDeleted++;
        });
        await batch.commit();
      }

      // 2. Also check for notifications stored with string timestamps or legacy timestamps
      const recentSnapshot = await db
        .collection('notifications')
        .orderBy('createdAt', 'asc')
        .limit(200)
        .get();

      if (!recentSnapshot.empty) {
        const batch = db.batch();
        let legacyCount = 0;
        recentSnapshot.forEach((doc) => {
          const d = doc.data();
          let cDate = null;
          if (d.createdAt && typeof d.createdAt.toDate === 'function') {
            cDate = d.createdAt.toDate();
          } else if (typeof d.createdAt === 'string') {
            cDate = new Date(d.createdAt);
          }
          if (cDate && !isNaN(cDate.getTime()) && cDate < cutoffDate) {
            batch.delete(doc.ref);
            legacyCount++;
            totalDeleted++;
          }
        });
        if (legacyCount > 0) {
          await batch.commit();
        }
      }

      console.log(`[NOTIFICATION CLEANUP] Purged ${totalDeleted} notifications older than ${days} days (cutoff: ${cutoffDate.toISOString()})`);
      return {
        success: true,
        deletedCount: totalDeleted,
        expirationDays: days,
        cutoffDate: cutoffDate.toISOString(),
      };
    } catch (err) {
      console.warn('[NOTIFICATION CLEANUP] Error during expired notifications cleanup:', err.message);
      return { success: false, error: err.message, deletedCount: totalDeleted };
    }
  }
}

module.exports = FcmNotificationService;
