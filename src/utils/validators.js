/**
 * Input Validators for Student Operations
 */

function validateRegistrationPayload(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return ['Request body must be a valid JSON object'];
  }

  // 1. Idempotency Request ID
  if (!data.requestId || typeof data.requestId !== 'string' || data.requestId.trim().length === 0) {
    errors.push('requestId is required for idempotency');
  }

  // 2. Student Identity
  if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2) {
    errors.push('Full student name is required (min 2 characters)');
  }

  // 3. Existing Registration / Roll Number
  if (!data.registrationNo || typeof data.registrationNo !== 'string' || data.registrationNo.trim().length === 0) {
    errors.push('Existing registration number is required');
  }

  // 4. Date of Birth (used for temp password generation)
  if (!data.dob || typeof data.dob !== 'string' || data.dob.trim().length === 0) {
    errors.push('Date of Birth is required for credential generation');
  }

  // 5. Course & Admission Details
  if (!data.course || typeof data.course !== 'string' || data.course.trim().length === 0) {
    errors.push('Course is required');
  }

  if (!data.admissionDate || typeof data.admissionDate !== 'string' || data.admissionDate.trim().length === 0) {
    errors.push('Admission Date is required');
  }

  // 6. Fee validations
  const totalFee = Number(data.totalFee);
  if (isNaN(totalFee) || totalFee < 0) {
    errors.push('Total fee must be a valid non-negative number');
  }

  const downPayment = Number(data.downPayment ?? 0);
  if (isNaN(downPayment) || downPayment < 0) {
    errors.push('Down payment must be a valid non-negative number');
  }

  if (downPayment > totalFee) {
    errors.push('Down payment cannot exceed total fee');
  }

  return errors;
}

function validateLoginPayload(data) {
  const errors = [];
  if (!data.studentId || typeof data.studentId !== 'string' || data.studentId.trim().length === 0) {
    errors.push('Student ID is required');
  }
  if (!data.password || typeof data.password !== 'string' || data.password.length === 0) {
    errors.push('Password is required');
  }
  return errors;
}

function validateChangePasswordPayload(data) {
  const errors = [];
  if (!data.newPassword || typeof data.newPassword !== 'string' || data.newPassword.length < 6) {
    errors.push('New password must be at least 6 characters');
  }
  return errors;
}

module.exports = {
  validateRegistrationPayload,
  validateLoginPayload,
  validateChangePasswordPayload,
};
