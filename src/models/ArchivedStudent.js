const mongoose = require('mongoose');

const ArchivedStudentSchema = new mongoose.Schema(
  {
    studentUid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    studentId: {
      type: String,
      required: true,
      index: true,
    },
    registrationNo: {
      type: String,
      default: '',
    },
    name: {
      type: String,
      required: true,
      index: true,
    },
    dob: {
      type: String,
      default: '',
    },
    gender: {
      type: String,
      default: '',
    },
    phone: {
      type: String,
      default: '',
    },
    email: {
      type: String,
      default: '',
    },
    internalEmail: {
      type: String,
      default: '',
    },
    category: {
      type: String,
      default: '',
    },
    address: {
      type: String,
      default: '',
    },
    parentName: {
      type: String,
      default: '',
    },
    parentPhone: {
      type: String,
      default: '',
    },
    guardianPhone: {
      type: String,
      default: '',
    },
    avatarUrl: {
      type: String,
      default: '',
    },
    course: {
      type: String,
      required: true,
      index: true,
    },
    courseId: {
      type: String,
      default: '',
    },
    batch: {
      type: String,
      default: '',
    },
    batchId: {
      type: String,
      default: '',
      index: true,
    },
    admissionDate: {
      type: String,
      default: '',
    },
    completionDate: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      default: 'Completed',
      index: true,
    },

    // Financial ledger snapshot
    feeSummary: {
      totalFee: { type: Number, default: 0 },
      paidFee: { type: Number, default: 0 },
      pendingFee: { type: Number, default: 0 },
      status: { type: String, default: 'Cleared' },
      isInstallmentPlan: { type: Boolean, default: false },
      installments: { type: Array, default: [] },
    },
    payments: [
      {
        paymentId: String,
        amount: Number,
        date: String,
        method: String,
        transactionId: String,
        receiptNo: String,
        status: String,
        verifiedAt: String,
      },
    ],

    // Attendance summary snapshot
    attendanceSummary: {
      totalClasses: { type: Number, default: 0 },
      attendedClasses: { type: Number, default: 0 },
      attendancePercentage: { type: Number, default: 0 },
      lastAttendedDate: { type: String, default: '' },
      records: { type: Array, default: [] },
    },

    // Academics: Test submissions & performance
    testResults: [
      {
        testId: String,
        testTitle: String,
        score: Number,
        totalMarks: Number,
        percentage: Number,
        grade: String,
        passed: Boolean,
        date: String,
      },
    ],

    // Issued Certificates
    certificates: [
      {
        certificateId: String,
        certificateNo: String,
        title: String,
        issueDate: String,
        grade: String,
        downloadUrl: String,
      },
    ],

    // Full original Firestore data snapshot for 100% loss-free backup
    originalSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Migration traceability
    migrationMetadata: {
      migratedAt: { type: Date, default: Date.now },
      migratedBy: { type: String, default: 'system' },
      migrationId: { type: String, required: true, index: true },
      checksum: { type: String, default: '' },
      version: { type: Number, default: 1 },
    },
  },
  {
    timestamps: true,
  }
);

ArchivedStudentSchema.index({ name: 'text', studentId: 'text', phone: 'text' });

module.exports = mongoose.model('ArchivedStudent', ArchivedStudentSchema);
