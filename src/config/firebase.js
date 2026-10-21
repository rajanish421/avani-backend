process.env.NO_GCE_CHECK = 'true';
process.env.DETECT_GCP_RETRIES = '0';

const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

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

function resolveFirebaseCredential() {
  // 1. Environment variable containing JSON (or base64-encoded JSON)
  const envServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (envServiceAccount) {
    try {
      let raw = envServiceAccount.trim();
      if (!raw.startsWith('{') && !raw.endsWith('}')) {
        raw = Buffer.from(raw, 'base64').toString('utf8');
      }
      const parsed = JSON.parse(raw);
      if (parsed.client_email && parsed.private_key) {
        console.log(`[FIREBASE CONFIG] Authenticating via FIREBASE_SERVICE_ACCOUNT env var (${parsed.client_email})`);
        return cert(parsed);
      }
    } catch (err) {
      console.error('[FIREBASE CONFIG] Failed to parse FIREBASE_SERVICE_ACCOUNT:', err.message);
    }
  }

  // 2. Individual environment variables (FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    try {
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      console.log(`[FIREBASE CONFIG] Authenticating via FIREBASE_CLIENT_EMAIL (${process.env.FIREBASE_CLIENT_EMAIL})`);
      return cert({
        projectId: process.env.FIREBASE_PROJECT_ID || projectId,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      });
    } catch (err) {
      console.error('[FIREBASE CONFIG] Failed to load individual env credentials:', err.message);
    }
  }

  // 3. File path locations (GOOGLE_APPLICATION_CREDENTIALS, secret files, local serviceAccountKey.json)
  const candidateFiles = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    '/etc/secrets/serviceAccountKey.json',
    '/etc/secrets/service-account.json',
    path.resolve(__dirname, '../../serviceAccountKey.json'),
    path.resolve(__dirname, '../serviceAccountKey.json'),
    path.resolve(__dirname, 'serviceAccountKey.json'),
  ].filter(Boolean);

  for (const filePath of candidateFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(fileContent);
        if (parsed.client_email && parsed.private_key) {
          console.log(`[FIREBASE CONFIG] Authenticating via service account file: ${filePath}`);
          return cert(parsed);
        }
      } catch (err) {
        console.warn(`[FIREBASE CONFIG] Could not parse file at ${filePath}:`, err.message);
      }
    }
  }

  // 4. Fallback for local development machine (ADC / gcloud)
  setupADCIfNeeded();
  try {
    return applicationDefault();
  } catch (err) {
    console.warn('[FIREBASE CONFIG] ADC resolution warning:', err.message);
  }

  return null;
}

let app;
if (getApps().length === 0) {
  try {
    const credential = resolveFirebaseCredential();
    const appOptions = { projectId: projectId };
    if (credential) {
      appOptions.credential = credential;
    }
    app = initializeApp(appOptions);
  } catch (error) {
    console.error('[FIREBASE CONFIG] Failed to initialize Firebase App:', error.message);
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
