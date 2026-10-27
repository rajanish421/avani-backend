const mongoose = require('mongoose');

const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27017/avani_institute_archive';


let isConnecting = false;

/**
 * Connect to MongoDB for archival storage
 * @param {string} [uri] Optional override URI
 */
async function connectMongo(uri = null) {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (isConnecting) {
    // Wait for ongoing connection attempt
    return new Promise((resolve, reject) => {
      mongoose.connection.once('open', () => resolve(mongoose.connection));
      mongoose.connection.once('error', reject);
    });
  }

  const mongoUri = uri || process.env.MONGODB_URI || DEFAULT_MONGO_URI;
  isConnecting = true;

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
    });
    console.log(`[MONGODB] Connected successfully to Archive Database (${mongoose.connection.name})`);
    return mongoose.connection;
  } catch (err) {
    console.error(`[MONGODB] Connection error: ${err.message}`);
    throw err;
  } finally {
    isConnecting = false;
  }
}

/**
 * Check if MongoDB is connected and ready
 * @returns {boolean}
 */
function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Gracefully close MongoDB connection (useful for graceful shutdown and tests)
 */
async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log('[MONGODB] Disconnected from Archive Database');
  }
}

// Event listeners for connection monitoring
mongoose.connection.on('disconnected', () => {
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[MONGODB] Connection lost. Attempting to reconnect...');
  }
});

mongoose.connection.on('error', (err) => {
  console.error('[MONGODB] Runtime connection error:', err.message);
});

module.exports = {
  mongoose,
  connectMongo,
  isMongoConnected,
  disconnectMongo,
  DEFAULT_MONGO_URI,
};
