const mongoose = require('mongoose');

const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27017/avani_institute_archive';

let isConnecting = false;
let wasEverConnected = false;
let isIntentionalDisconnect = false;

/**
 * Safely masks MongoDB URI credentials for logging
 * @param {string} uri
 * @returns {string}
 */
function maskMongoUri(uri) {
  if (!uri || typeof uri !== 'string') return '';
  return uri.replace(/:([^:@]+)@/, ':****@');
}

/**
 * Resolves configured MongoDB URI from environment variables with graceful fallback
 * @param {string|null} overrideUri
 * @returns {string|null}
 */
function resolveMongoUri(overrideUri = null) {
  if (overrideUri && typeof overrideUri === 'string' && overrideUri.trim()) {
    return overrideUri.trim();
  }

  const envUri = (
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    process.env.MONGODB_URL ||
    process.env.DATABASE_URL ||
    ''
  ).trim();

  if (envUri) {
    return envUri;
  }

  // In production (Render, Heroku, Cloud Run), never attempt connecting to localhost
  const isProduction = process.env.NODE_ENV === 'production';
  return isProduction ? null : DEFAULT_MONGO_URI;
}

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

  const mongoUri = resolveMongoUri(uri);

  if (!mongoUri) {
    console.warn(
      '[MONGODB] Notice: No MongoDB connection URI detected in environment (MONGODB_URI or MONGO_URI). Archival database features will remain idle until configured.'
    );
    return null;
  }

  isConnecting = true;
  console.log(`[MONGODB] Connecting to Archive Database (${maskMongoUri(mongoUri)})...`);

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 10,
      dbName: process.env.MONGO_DB_NAME || 'avani_institute_archive',
    });
    wasEverConnected = true;
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
    isIntentionalDisconnect = true;
    try {
      await mongoose.disconnect();
      console.log('[MONGODB] Disconnected from Archive Database');
    } finally {
      isIntentionalDisconnect = false;
    }
  }
}

// Event listeners for connection monitoring
mongoose.connection.on('open', () => {
  wasEverConnected = true;
});

mongoose.connection.on('disconnected', () => {
  if (wasEverConnected && !isIntentionalDisconnect && process.env.NODE_ENV !== 'test') {
    console.warn('[MONGODB] Connection lost. Attempting to reconnect...');
  }
});

mongoose.connection.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error('[MONGODB] Runtime connection error:', err.message);
  }
});

module.exports = {
  mongoose,
  connectMongo,
  isMongoConnected,
  disconnectMongo,
  resolveMongoUri,
  maskMongoUri,
  DEFAULT_MONGO_URI,
};
