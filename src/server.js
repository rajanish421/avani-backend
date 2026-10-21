const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();
const app = require('./app');
const FcmNotificationService = require('./services/fcmNotificationService');
const DailyGreetingsService = require('./services/dailyGreetingsService');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Institute Backend Service Started `);
  console.log(` Server Port: http://localhost:${PORT}`);
  console.log(` Health Check: http://localhost:${PORT}/api/health`);
  console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`====================================================`);

  // Run initial automated cleanup for notifications older than 30 days
  FcmNotificationService.cleanExpiredNotifications(30).catch((err) => {
    console.warn('[SERVER INIT] Initial expired notifications cleanup warning:', err.message);
  });

  // Schedule recurring 30-day automatic notification purge every 6 hours
  setInterval(() => {
    FcmNotificationService.cleanExpiredNotifications(30).catch((err) => {
      console.warn('[CLEANUP CRON] Recurring expired notifications cleanup warning:', err.message);
    });
  }, 6 * 60 * 60 * 1000);

  // Initialize automated morning festival and birthday greeting scheduler (8:00 AM – 9:00 AM IST)
  try {
    DailyGreetingsService.scheduleMorningGreetings();
  } catch (err) {
    console.warn('[SERVER INIT] Morning greetings scheduler init warning:', err.message);
  }
});
