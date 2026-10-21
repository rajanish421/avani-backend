process.env.NO_GCE_CHECK = 'true';
process.env.DETECT_GCP_RETRIES = '0';

const { initializeApp, getApps, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const fs = require('fs');
const os = require('os');
const path = require('path');
// Ensure .env is loaded from institute_backend root regardless of current working directory
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

const projectId = process.env.FIREBASE_PROJECT_ID || 'avani-computer-institute-44b7f';
const apiKey = process.env.FIREBASE_API_KEY || 'AIzaSyAjl70sGRFrgT60QgQOxQj18TQy5ZceGfc';

function setupADCIfNeeded() {
  const adcPath = path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
  const tokenFile = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

  if (fs.existsSync(tokenFile)) {
    try {
      const config = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      if (config.tokens && config.tokens.refresh_token) {
        let needsUpdate = true;
        if (fs.existsSync(adcPath)) {
          try {
            const existingAdc = JSON.parse(fs.readFileSync(adcPath, 'utf8'));
            if (existingAdc.refresh_token === config.tokens.refresh_token) {
              needsUpdate = false;
            }
          } catch (_) {}
        }
        if (needsUpdate) {
          fs.mkdirSync(path.dirname(adcPath), { recursive: true });
          const adcData = {
            client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
            client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
            refresh_token: config.tokens.refresh_token,
            type: 'authorized_user',
          };
          fs.writeFileSync(adcPath, JSON.stringify(adcData, null, 2));
          console.log('[FIREBASE CONFIG] Synced application default credentials with current Firebase token.');
        }
      }
    } catch (err) {
      console.warn('[FIREBASE CONFIG] Could not auto-sync ADC file:', err.message);
    }
  }
}

setupADCIfNeeded();

let app;
if (getApps().length === 0) {
  try {
    app = initializeApp({
      credential: applicationDefault(),
      projectId: projectId,
    });
  } catch (error) {
    console.error('[FIREBASE CONFIG] Failed to initialize Firebase App with ADC:', error.message);
    app = initializeApp({ projectId: projectId });
  }
} else {
  app = getApps()[0];
}

const db = getFirestore(app);
try {
  db.settings({ ignoreUndefinedProperties: true });
} catch (_) {}
const auth = getAuth(app);
let messaging;
try {
  const { getMessaging } = require('firebase-admin/messaging');
  messaging = getMessaging(app);
} catch (e) {
  console.warn('[FIREBASE CONFIG] Messaging initialization notice:', e.message);
}

module.exports = {
  app,
  db,
  auth,
  messaging,
  FieldValue,
  projectId,
  apiKey,
};
