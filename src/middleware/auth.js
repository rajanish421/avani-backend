const { auth, db } = require('../config/firebase');

/**
 * Middleware: Verify Admin Firebase Auth Token & Authorization
 */
async function verifyAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized: Missing or invalid Authorization header.',
    });
  }

  const token = authHeader.split('Bearer ')[1].trim();
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Empty bearer token.' });
  }

  // Development/Test mock token bypass
  if ((process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development' || process.env.ALLOW_TEST_AUTH === 'true') && token.startsWith('mock_admin_')) {
    req.adminUser = {
      uid: token.replace('mock_admin_', ''),
      email: 'admin@institute.com',
      name: 'Admin Test User',
      role: 'admin',
    };
    return next();
  }

  try {
    const decodedToken = await auth.verifyIdToken(token);
    const email = (decodedToken.email || '').toLowerCase().trim();
    let isAuthorized = false;

    // 1. Custom Claims check
    if (decodedToken.admin === true || decodedToken.role === 'admin') {
      isAuthorized = true;
    }

    // 2. Firestore admins collection verification (by UID and by email)
    if (!isAuthorized) {
      try {
        let adminDoc = await db.collection('admins').doc(decodedToken.uid).get();
        if (!adminDoc.exists && email) {
          const emailQuery = await db.collection('admins').where('email', '==', email).limit(1).get();
          if (!emailQuery.empty) {
            adminDoc = emailQuery.docs[0];
            // Link UID document for future lookups
            await db.collection('admins').doc(decodedToken.uid).set({
              ...adminDoc.data(),
              uid: decodedToken.uid,
              userId: decodedToken.uid,
            }, { merge: true });
          }
        }
        if (adminDoc.exists) {
          const data = adminDoc.data();
          const isActive = data.isActive === true || data.active === true;
          if (isActive) {
            isAuthorized = true;
          }
        }
      } catch (dbErr) {
        console.warn('[AUTH MIDDLEWARE] Error verifying admin doc:', dbErr.message);
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({
        error: 'Forbidden: Access denied. This endpoint requires verified administrator authorization.',
      });
    }

    req.adminUser = decodedToken;
    return next();
  } catch (error) {
    return res.status(401).json({
      error: 'Unauthorized: Invalid or expired Firebase ID token.',
      details: error.message,
    });
  }
}

/**
 * Middleware: Verify Student Firebase Auth Token
 */
async function verifyStudentAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized: Missing or invalid Authorization header.',
    });
  }

  const token = authHeader.split('Bearer ')[1].trim();
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Empty bearer token.' });
  }

  // Development/Test mock token bypass
  if ((process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development' || process.env.ALLOW_TEST_AUTH === 'true') && token.startsWith('mock_student_')) {
    const rawId = token.replace('mock_student_', '');
    req.studentUser = {
      uid: rawId,
      email: `${rawId}@students.avani.internal`,
      studentId: rawId.startsWith('ACI') ? rawId : undefined,
    };
    return next();
  }

  try {
    const decodedToken = await auth.verifyIdToken(token);
    req.studentUser = decodedToken;
    return next();
  } catch (error) {
    return res.status(401).json({
      error: 'Unauthorized: Invalid or expired student session.',
      details: error.message,
    });
  }
}

module.exports = {
  verifyAdminAuth,
  verifyStudentAuth,
};
