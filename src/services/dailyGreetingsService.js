const { db, FieldValue } = require('../config/firebase');
const FcmNotificationService = require('./fcmNotificationService');

/**
 * Fixed annual national and cultural festivals (MM-DD)
 */
const FIXED_ANNUAL_FESTIVALS = {
  '01-01': {
    name: "New Year's Day",
    title: '✨ Happy New Year! 🎉',
    message: 'Avani Computer Institute wishes all our students, faculty, and administrators a joyful, prosperous, and successful New Year! May all your learning goals come true!',
  },
  '01-14': {
    name: 'Makar Sankranti / Pongal',
    title: '🪁 Happy Makar Sankranti & Pongal! 🌾',
    message: 'Warm wishes on the joyous occasion of Makar Sankranti and Pongal to all students and staff! May this season of harvest bring boundless happiness and good fortune.',
  },
  '01-26': {
    name: 'Republic Day',
    title: '🇮🇳 Happy Republic Day! 🇮🇳',
    message: "Proud greetings to all students, administration, and faculty on India's Republic Day! Let us uphold the values of education, discipline, and nation-building.",
  },
  '04-14': {
    name: 'Dr. B.R. Ambedkar Jayanti',
    title: '💐 Dr. B.R. Ambedkar Jayanti 📚',
    message: "Saluting the chief architect of India's Constitution on Ambedkar Jayanti. Knowledge is the key to empowerment—study hard and excel!",
  },
  '08-15': {
    name: 'Independence Day',
    title: '🇮🇳 Happy Independence Day! 🇮🇳',
    message: 'Warm Independence Day greetings to all students, administration, and teachers! Celebrate freedom and technological empowerment with pride.',
  },
  '09-05': {
    name: "Teachers' Day",
    title: "💐 Happy Teachers' Day! 🎓",
    message: 'Gratitude and warm wishes to all our dedicated teachers, trainers, and administrators shaping the computer leaders of tomorrow!',
  },
  '10-02': {
    name: 'Mahatma Gandhi Jayanti',
    title: '🕊️ Happy Gandhi Jayanti 🕊️',
    message: 'Commemorating the legacy of truth, peace, and perseverance on Mahatma Gandhi Jayanti. Best wishes to all students, teachers, and staff!',
  },
  '11-14': {
    name: "Children's Day",
    title: "🎈 Happy Children's Day! 🌟",
    message: 'Wishing a very Happy Children’s Day to all our energetic and curious learners! Keep learning, coding, and building your future!',
  },
  '12-25': {
    name: 'Christmas',
    title: '🎄 Merry Christmas! 🎅',
    message: 'Avani Computer Institute wishes all students, admin, and their families peace, joy, and goodwill this Christmas season!',
  },
};

/**
 * Variable lunar / calendar-specific festivals mapped by YYYY-MM-DD
 */
const VARIABLE_FESTIVALS = {
  // 2024
  '2024-03-08': { name: 'Maha Shivratri', title: '🔱 Happy Maha Shivratri! 🔱', message: 'May Lord Shiva bless you and your family with peace, wisdom, and success.' },
  '2024-03-25': { name: 'Holi', title: '🎨 Happy Holi! 🌈', message: 'Wishing all students and staff a vibrant, safe, and joyful festival of colours!' },
  '2024-04-11': { name: 'Eid-ul-Fitr', title: '🌙 Eid Mubarak! 🌙', message: 'May this blessed Eid bring peace, happiness, and prosperity to you and your loved ones.' },
  '2024-04-17': { name: 'Ram Navami', title: '🏹 Happy Ram Navami! 🌸', message: 'Wishing you righteousness, strength, and joy on Ram Navami.' },
  '2024-08-19': { name: 'Raksha Bandhan', title: '🧵 Happy Raksha Bandhan! 🌸', message: 'Celebrating the cherished bond of love, protection, and care on Raksha Bandhan.' },
  '2024-08-26': { name: 'Krishna Janmashtami', title: '🦚 Happy Krishna Janmashtami! 🪈', message: 'May Lord Krishna shower divine blessings, wisdom, and joy upon your life.' },
  '2024-09-07': { name: 'Ganesh Chaturthi', title: '🐘 Happy Ganesh Chaturthi! 🌺', message: 'May Lord Ganesha remove all obstacles and guide your learning journey to victory!' },
  '2024-10-12': { name: 'Dussehra / Vijayadashami', title: '🏹 Happy Dussehra! 🏹', message: 'May the triumph of good over evil inspire you to conquer every challenge and achieve greatness.' },
  '2024-11-01': { name: 'Diwali', title: '🪔 Happy Diwali! 🪔', message: 'May the festival of lights illuminate your life with knowledge, health, and prosperity!' },
  '2024-11-03': { name: 'Bhai Dooj', title: '🌸 Happy Bhai Dooj! 🌸', message: 'Warmest wishes on Bhai Dooj celebrating kinship and goodwill.' },
  '2024-11-07': { name: 'Chhath Puja', title: '☀️ Happy Chhath Puja! ☀️', message: 'Greetings on the sacred festival of Chhath Puja dedicated to the Sun God.' },
  '2024-11-15': { name: 'Guru Nanak Jayanti', title: '☬ Happy Guru Nanak Jayanti! ☬', message: 'May the divine teachings of Guru Nanak Dev Ji guide you towards truth and wisdom.' },

  // 2025
  '2025-02-26': { name: 'Maha Shivratri', title: '🔱 Happy Maha Shivratri! 🔱', message: 'May Lord Shiva bless you and your family with peace, wisdom, and success.' },
  '2025-03-14': { name: 'Holi', title: '🎨 Happy Holi! 🌈', message: 'Wishing all students and staff a vibrant, safe, and joyful festival of colours!' },
  '2025-03-31': { name: 'Eid-ul-Fitr', title: '🌙 Eid Mubarak! 🌙', message: 'May this blessed Eid bring peace, happiness, and prosperity to you and your loved ones.' },
  '2025-04-06': { name: 'Ram Navami', title: '🏹 Happy Ram Navami! 🌸', message: 'Wishing you righteousness, strength, and joy on Ram Navami.' },
  '2025-08-09': { name: 'Raksha Bandhan', title: '🧵 Happy Raksha Bandhan! 🌸', message: 'Celebrating the cherished bond of love, protection, and care on Raksha Bandhan.' },
  '2025-08-16': { name: 'Krishna Janmashtami', title: '🦚 Happy Krishna Janmashtami! 🪈', message: 'May Lord Krishna shower divine blessings, wisdom, and joy upon your life.' },
  '2025-08-27': { name: 'Ganesh Chaturthi', title: '🐘 Happy Ganesh Chaturthi! 🌺', message: 'May Lord Ganesha remove all obstacles and guide your learning journey to victory!' },
  '2025-10-02': { name: 'Dussehra / Vijayadashami', title: '🏹 Happy Dussehra! 🏹', message: 'May the triumph of good over evil inspire you to conquer every challenge and achieve greatness.' },
  '2025-10-20': { name: 'Diwali', title: '🪔 Happy Diwali! 🪔', message: 'May the festival of lights illuminate your life with knowledge, health, and prosperity!' },
  '2025-10-22': { name: 'Bhai Dooj', title: '🌸 Happy Bhai Dooj! 🌸', message: 'Warmest wishes on Bhai Dooj celebrating kinship and goodwill.' },
  '2025-10-27': { name: 'Chhath Puja', title: '☀️ Happy Chhath Puja! ☀️', message: 'Greetings on the sacred festival of Chhath Puja dedicated to the Sun God.' },
  '2025-11-05': { name: 'Guru Nanak Jayanti', title: '☬ Happy Guru Nanak Jayanti! ☬', message: 'May the divine teachings of Guru Nanak Dev Ji guide you towards truth and wisdom.' },

  // 2026
  '2026-02-15': { name: 'Maha Shivratri', title: '🔱 Happy Maha Shivratri! 🔱', message: 'May Lord Shiva bless you and your family with peace, wisdom, and success.' },
  '2026-03-04': { name: 'Holi', title: '🎨 Happy Holi! 🌈', message: 'Wishing all students and staff a vibrant, safe, and joyful festival of colours!' },
  '2026-03-20': { name: 'Eid-ul-Fitr', title: '🌙 Eid Mubarak! 🌙', message: 'May this blessed Eid bring peace, happiness, and prosperity to you and your loved ones.' },
  '2026-03-27': { name: 'Ram Navami', title: '🏹 Happy Ram Navami! 🌸', message: 'Wishing you righteousness, strength, and joy on Ram Navami.' },
  '2026-05-27': { name: 'Eid-ul-Adha (Bakrid)', title: '🌙 Eid-ul-Adha Mubarak! 🌙', message: 'May the spirit of devotion and compassion bring peace and blessings to all.' },
  '2026-08-28': { name: 'Raksha Bandhan', title: '🧵 Happy Raksha Bandhan! 🌸', message: 'Celebrating the cherished bond of love, protection, and care on Raksha Bandhan.' },
  '2026-09-04': { name: 'Krishna Janmashtami', title: '🦚 Happy Krishna Janmashtami! 🪈', message: 'May Lord Krishna shower divine blessings, wisdom, and joy upon your life.' },
  '2026-09-14': { name: 'Ganesh Chaturthi', title: '🐘 Happy Ganesh Chaturthi! 🌺', message: 'May Lord Ganesha remove all obstacles and guide your learning journey to victory!' },
  '2026-10-20': { name: 'Dussehra / Vijayadashami', title: '🏹 Happy Dussehra! 🏹', message: 'May the triumph of good over evil inspire you to conquer every challenge and achieve greatness.' },
  '2026-11-08': { name: 'Diwali', title: '🪔 Happy Diwali! 🪔', message: 'May the festival of lights illuminate your life with knowledge, health, and prosperity!' },
  '2026-11-10': { name: 'Bhai Dooj', title: '🌸 Happy Bhai Dooj! 🌸', message: 'Warmest wishes on Bhai Dooj celebrating kinship and goodwill.' },
  '2026-11-15': { name: 'Chhath Puja', title: '☀️ Happy Chhath Puja! ☀️', message: 'Greetings on the sacred festival of Chhath Puja dedicated to the Sun God.' },
  '2026-11-24': { name: 'Guru Nanak Jayanti', title: '☬ Happy Guru Nanak Jayanti! ☬', message: 'May the divine teachings of Guru Nanak Dev Ji guide you towards truth and wisdom.' },

  // 2027
  '2027-03-06': { name: 'Maha Shivratri', title: '🔱 Happy Maha Shivratri! 🔱', message: 'May Lord Shiva bless you and your family with peace, wisdom, and success.' },
  '2027-03-22': { name: 'Holi', title: '🎨 Happy Holi! 🌈', message: 'Wishing all students and staff a vibrant, safe, and joyful festival of colours!' },
  '2027-03-10': { name: 'Eid-ul-Fitr', title: '🌙 Eid Mubarak! 🌙', message: 'May this blessed Eid bring peace, happiness, and prosperity to you and your loved ones.' },
  '2027-04-15': { name: 'Ram Navami', title: '🏹 Happy Ram Navami! 🌸', message: 'Wishing you righteousness, strength, and joy on Ram Navami.' },
  '2027-10-09': { name: 'Dussehra', title: '🏹 Happy Dussehra! 🏹', message: 'Wishing all students and staff peace and success on Dussehra.' },
  '2027-10-29': { name: 'Diwali', title: '🪔 Happy Diwali! 🪔', message: 'May the festival of lights bring prosperity and knowledge to all.' },
};

class DailyGreetingsService {
  /**
   * Get current date parts in Indian Standard Time (IST)
   */
  static getTodayIST(customDate = null) {
    const d = customDate ? new Date(customDate) : new Date();
    const istFormatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = istFormatter.formatToParts(d);
    const day = parseInt(parts.find((p) => p.type === 'day').value, 10);
    const month = parseInt(parts.find((p) => p.type === 'month').value, 10);
    const year = parseInt(parts.find((p) => p.type === 'year').value, 10);
    const dateIso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const mmDd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { day, month, year, dateIso, mmDd };
  }

  /**
   * Parse a student's date of birth into { day, month }
   */
  static parseStudentDob(dob) {
    if (!dob) return null;

    // Handle Firestore Timestamp or Date object
    if (typeof dob.toDate === 'function') {
      const dt = dob.toDate();
      return { day: dt.getDate(), month: dt.getMonth() + 1 };
    }
    if (dob instanceof Date) {
      return { day: dob.getDate(), month: dob.getMonth() + 1 };
    }

    const clean = String(dob).trim();
    if (!clean) return null;

    // Try ISO YYYY-MM-DD
    const isoMatch = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (isoMatch) {
      return { day: parseInt(isoMatch[3], 10), month: parseInt(isoMatch[2], 10) };
    }

    // Try DD-MM-YYYY or DD/MM/YYYY
    const dmyMatch = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dmyMatch) {
      return { day: parseInt(dmyMatch[1], 10), month: parseInt(dmyMatch[2], 10) };
    }

    // Try format with textual month e.g. "20 Oct 2004"
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const parts = clean.split(/[\s,]+/);
    if (parts.length >= 2) {
      const dayVal = parseInt(parts[0], 10);
      const monStr = parts[1].toLowerCase().slice(0, 3);
      const mIdx = months.indexOf(monStr);
      if (!isNaN(dayVal) && mIdx !== -1) {
        return { day: dayVal, month: mIdx + 1 };
      }
    }

    return null;
  }

  /**
   * Look up festival for today's date
   */
  static async getFestivalForDate(dateIso, mmDd) {
    // 1. Check fixed annual dictionary
    if (FIXED_ANNUAL_FESTIVALS[mmDd]) {
      return FIXED_ANNUAL_FESTIVALS[mmDd];
    }

    // 2. Check variable date dictionary
    if (VARIABLE_FESTIVALS[dateIso]) {
      return VARIABLE_FESTIVALS[dateIso];
    }

    // 3. Check custom Firestore /institute_festivals or /holidays collection
    try {
      const doc = await db.collection('institute_festivals').doc(dateIso).get();
      if (doc.exists) {
        const d = doc.data();
        return {
          name: d.name || 'Institute Festival',
          title: d.title || `✨ Happy ${d.name || 'Festival'}! 🎉`,
          message: d.message || `Warm wishes to all students and staff on ${d.name || 'this festival'}!`,
        };
      }
    } catch (_) {}

    return null;
  }

  /**
   * Main executor: Checks and triggers morning greetings for festivals & birthdays
   * @param {Object} options
   * @param {string|Date} [options.date] - Optional custom date (for testing or manual run)
   * @param {boolean} [options.force] - If true, bypasses daily deduplication log
   */
  static async checkAndTriggerGreetings({ date = null, force = false } = {}) {
    const today = this.getTodayIST(date);
    const dateIso = today.dateIso;
    console.log(`[DAILY GREETINGS] Checking greetings for date: ${dateIso} (IST)`);

    const logRef = db.collection('daily_greetings_log').doc(dateIso);
    let logDoc = null;
    try {
      logDoc = await logRef.get();
    } catch (err) {
      console.warn('[DAILY GREETINGS] Warning reading daily_greetings_log:', err.message);
    }

    const logData = (logDoc && logDoc.exists) ? logDoc.data() : {};
    const birthdayUidsSent = new Set(logData.birthdayUidsSent || []);
    let festivalSent = Boolean(logData.festivalSent);

    const results = {
      date: dateIso,
      festival: null,
      birthdays: [],
    };

    // ------------------------------------------------------------------------
    // 1. Process Festival Greeting (To All Students and Admin)
    // ------------------------------------------------------------------------
    const festival = await this.getFestivalForDate(dateIso, today.mmDd);
    if (festival) {
      if (!festivalSent || force) {
        try {
          console.log(`[DAILY GREETINGS] Triggering festival greeting for: ${festival.name}`);
          const festivalRes = await FcmNotificationService.sendFestivalWishNotification({
            festivalName: festival.name,
            title: festival.title,
            message: festival.message,
            category: 'Festival',
          });

          // Also record in /admin_notifications so Admin Dashboard gets instant notice
          try {
            await db.collection('admin_notifications').add({
              type: 'festival_wish',
              title: festival.title,
              message: festival.message,
              festivalName: festival.name,
              category: 'Festival',
              isRead: false,
              createdAt: FieldValue.serverTimestamp(),
            });
          } catch (e) {
            console.warn('[DAILY GREETINGS] Failed to save festival to admin_notifications:', e.message);
          }

          // Also dispatch push notification to admin topic
          try {
            await FcmNotificationService.sendToTopic('admin', {
              title: festival.title,
              body: festival.message,
              data: { festivalName: festival.name, category: 'Festival' },
              type: 'festival_wish',
            });
          } catch (_) {}

          festivalSent = true;
          results.festival = {
            sent: true,
            festivalName: festival.name,
            title: festival.title,
            notificationId: festivalRes.notificationId,
          };
        } catch (err) {
          console.error('[DAILY GREETINGS] Error sending festival notification:', err.message);
          results.festival = { sent: false, error: err.message };
        }
      } else {
        results.festival = { sent: false, skipped: 'Already sent today', festivalName: festival.name };
      }
    } else {
      results.festival = { sent: false, reason: 'No festival scheduled today' };
    }

    // ------------------------------------------------------------------------
    // 2. Process Birthday Wishes (Strictly to matching students only)
    // ------------------------------------------------------------------------
    try {
      const studentsSnapshot = await db.collection('students').get();
      const birthdayStudents = [];

      studentsSnapshot.forEach((doc) => {
        const data = doc.data();
        const studentUid = doc.id;
        const dob = data.dob || data.dateOfBirth;
        if (!dob) return;

        const parsedDob = this.parseStudentDob(dob);
        if (parsedDob && parsedDob.day === today.day && parsedDob.month === today.month) {
          birthdayStudents.push({
            studentUid,
            studentName: data.name || data.fullName || 'Student',
            fcmToken: data.fcmToken || null,
          });
        }
      });

      console.log(`[DAILY GREETINGS] Found ${birthdayStudents.length} student(s) with birthday today (${dateIso})`);

      for (const student of birthdayStudents) {
        if (!birthdayUidsSent.has(student.studentUid) || force) {
          try {
            const bRes = await FcmNotificationService.sendBirthdayWishNotification({
              studentUid: student.studentUid,
              studentName: student.studentName,
            });
            birthdayUidsSent.add(student.studentUid);
            results.birthdays.push({
              studentUid: student.studentUid,
              studentName: student.studentName,
              sent: true,
              notificationId: bRes.notificationId,
            });
          } catch (err) {
            console.error(`[DAILY GREETINGS] Error sending birthday wish to ${student.studentUid}:`, err.message);
            results.birthdays.push({
              studentUid: student.studentUid,
              studentName: student.studentName,
              sent: false,
              error: err.message,
            });
          }
        } else {
          results.birthdays.push({
            studentUid: student.studentUid,
            studentName: student.studentName,
            sent: false,
            skipped: 'Already sent today',
          });
        }
      }
    } catch (err) {
      console.error('[DAILY GREETINGS] Error scanning students for birthdays:', err.message);
    }

    // ------------------------------------------------------------------------
    // 3. Update Daily Log for Deduplication
    // ------------------------------------------------------------------------
    try {
      await logRef.set(
        {
          date: dateIso,
          festivalSent,
          festivalName: festival ? festival.name : '',
          birthdayUidsSent: Array.from(birthdayUidsSent),
          lastRunAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('[DAILY GREETINGS] Warning writing daily_greetings_log:', err.message);
    }

    return results;
  }

  /**
   * Schedule automated morning check (between 7:00 AM and 8:00 AM IST)
   */
  static scheduleMorningGreetings() {
    console.log('[DAILY GREETINGS] Initializing automated morning greeting cron timer (7:00 AM – 8:00 AM IST)');

    // Run a check shortly after startup if during morning window
    setTimeout(() => {
      this._checkIfMorningAndRun();
    }, 5000);

    // Repeat check every 15 minutes
    setInterval(() => {
      this._checkIfMorningAndRun();
    }, 15 * 60 * 1000);
  }

  static _checkIfMorningAndRun() {
    const now = new Date();
    const istFormatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = istFormatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour').value, 10);

    // Active morning delivery window starts at 7:00 AM IST.
    // If hour >= 7, check and trigger greetings for today if not already sent.
    // Deduplication via daily_greetings_log guarantees it only executes once per day.
    if (hour >= 7) {
      this.checkAndTriggerGreetings().catch((err) => {
        console.warn('[DAILY GREETINGS CRON] Execution warning:', err.message);
      });
    }
  }
}

module.exports = DailyGreetingsService;
