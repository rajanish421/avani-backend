const express = require('express');
const cors = require('cors');
const studentRoutes = require('./routes/studentRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const app = express();

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Safe request logger (never logs passwords or sensitive credentials)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[${req.method}] ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'Avani Institute Backend',
    timestamp: new Date().toISOString(),
  });
});

// Mount routes
app.use('/api/students', studentRoutes);
app.use('/api/notifications', notificationRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
});

// Centralized error handler
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || (err.status >= 400 && err.status < 600 ? err.status : 500);
  const message = err.message || 'Internal Server Error';

  if (statusCode >= 500 && process.env.NODE_ENV !== 'test') {
    console.error('[SERVER ERROR]', err);
  }

  res.status(statusCode).json({
    error: message,
    code: err.code || 'ERROR',
    errorCode: err.code || 'ERROR',
    statusCode: statusCode,
  });
});

module.exports = app;
