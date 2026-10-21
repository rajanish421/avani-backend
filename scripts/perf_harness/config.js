const path = require('path');

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyBydz4yuUM3eQf2xU-lBMgSLzrF2FTljFI',
  authDomain: 'avani-computer-institute-44b7f.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID || 'avani-computer-institute-44b7f',
  storageBucket: 'avani-computer-institute-44b7f.firebasestorage.app',
  messagingSenderId: '117699481531',
  appId: '1:117699481531:web:f89f6e76bb35003d5e7e9e',
  databaseURL: 'https://avani-computer-institute-44b7f-default-rtdb.firebaseio.com',
};

// Spark (Free Plan) Limits
const SPARK_LIMITS = {
  FIRESTORE_READS_PER_DAY: 50000,
  FIRESTORE_WRITES_PER_DAY: 20000,
  FIRESTORE_DELETES_PER_DAY: 20000,
  FIRESTORE_STORAGE_BYTES: 1024 * 1024 * 1024, // 1 GiB
  FIRESTORE_EGRESS_BYTES_MONTH: 10 * 1024 * 1024 * 1024, // 10 GiB
  RTDB_CONCURRENT_CONNECTIONS: 100,
  RTDB_DOWNLOAD_BYTES_MONTH: 10 * 1024 * 1024 * 1024, // 10 GB
  AUTH_MAU: 50000,
};

// 80% Safety Stops
const SAFETY_CIRCUIT_BREAKERS = {
  MAX_FIRESTORE_READS: 40000,
  MAX_FIRESTORE_WRITES: 16000,
  MAX_FIRESTORE_DELETES: 16000,
  MAX_RTDB_CONCURRENT: 80,
};

const TEST_PREFIX = '__perf_';
const MANIFEST_FILE = path.join(__dirname, 'test_manifest.json');
const REPORTS_DIR = path.join(__dirname, 'reports');

module.exports = {
  firebaseConfig,
  SPARK_LIMITS,
  SAFETY_CIRCUIT_BREAKERS,
  TEST_PREFIX,
  MANIFEST_FILE,
  REPORTS_DIR,
};
