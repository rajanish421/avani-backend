const mongoose = require('mongoose');

const ArchivedBatchSchema = new mongoose.Schema(
  {
    batchId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    code: {
      type: String,
      default: '',
    },
    name: {
      type: String,
      required: true,
      index: true,
    },
    course: {
      type: String,
      required: true,
      index: true,
    },
    timeSlot: {
      type: String,
      default: '',
    },
    days: {
      type: [String],
      default: [],
    },
    trainer: {
      type: String,
      default: '',
    },
    labRoom: {
      type: String,
      default: '',
    },
    capacity: {
      type: Number,
      default: 0,
    },
    startDate: {
      type: String,
      default: '',
    },
    endDate: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      default: 'Archived',
      index: true,
    },
    completedStudentsCount: {
      type: Number,
      default: 0,
    },
    studentUids: {
      type: [String],
      default: [],
    },
    assignedStudentIds: {
      type: [String],
      default: [],
    },
    attendanceSummary: {
      totalSessions: { type: Number, default: 0 },
      averageAttendancePct: { type: Number, default: 0 },
    },
    originalSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    migrationMetadata: {
      migratedAt: { type: Date, default: Date.now },
      migratedBy: { type: String, default: 'system' },
      migrationId: { type: String, required: true, index: true },
      checksum: { type: String, default: '' },
    },
  },
  {
    timestamps: true,
  }
);

ArchivedBatchSchema.index({ name: 'text', code: 'text', course: 'text' });

module.exports = mongoose.model('ArchivedBatch', ArchivedBatchSchema);
