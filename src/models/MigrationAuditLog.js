const mongoose = require('mongoose');

const MigrationAuditLogSchema = new mongoose.Schema(
  {
    migrationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['batch', 'student'],
      required: true,
      index: true,
    },
    targetId: {
      type: String,
      required: true,
      index: true,
    },
    targetName: {
      type: String,
      default: '',
    },
    adminUid: {
      type: String,
      default: 'admin',
    },
    status: {
      type: String,
      enum: ['PREVIEW', 'IN_PROGRESS', 'VERIFIED', 'COMPLETED', 'FAILED', 'ROLLED_BACK'],
      default: 'IN_PROGRESS',
      index: true,
    },
    studentUids: {
      type: [String],
      default: [],
    },
    studentCount: {
      type: Number,
      default: 0,
    },
    verificationPassed: {
      type: Boolean,
      default: false,
    },
    firestorePruned: {
      type: Boolean,
      default: false,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    error: {
      type: String,
      default: null,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('MigrationAuditLog', MigrationAuditLogSchema);
