/**
 * Centralized Institute Configuration
 * White-label configuration that allows modifying institute details,
 * student ID format/prefix, counter padding, and institutional policies.
 */

const instituteConfig = {
  // Identity
  instituteName: process.env.INSTITUTE_NAME || 'Avani Computer Institute',
  shortCode: process.env.INSTITUTE_SHORT_CODE || 'ACI',
  
  // Student ID Generation Pattern:
  // e.g. prefix 'ACI' + 5 digit sequence -> 'ACI00001', 'ACI00002', etc.
  studentIdPrefix: process.env.INSTITUTE_SHORT_CODE || 'ACI',
  counterPaddingDigits: 5,

  // Internal Auth Email Alias Domain (never exposed to students)
  internalEmailDomain: process.env.INTERNAL_EMAIL_DOMAIN || 'students.avani.internal',

  // Policy Flags
  forcePasswordChangeOnFirstLogin: true,
  tempPasswordFormat: 'DDMMYYYY', // DOB format

  // Helper to format student ID from integer sequence
  formatStudentId(sequenceNumber, prefix = null) {
    const p = prefix || this.studentIdPrefix;
    const paddedSeq = String(sequenceNumber).padStart(this.counterPaddingDigits, '0');
    return `${p}${paddedSeq}`;
  },

  // Helper to build internal email alias for Auth
  buildInternalEmail(uid) {
    const cleanUid = uid.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return `${cleanUid}@${this.internalEmailDomain}`;
  }
};

module.exports = instituteConfig;
