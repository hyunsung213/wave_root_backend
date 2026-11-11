const mongoose = require('mongoose');
const { SITE_CODES } = require('../config/farmSites');

const commandSchema = new mongoose.Schema(
  {
    plantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      required: true,
      index: true
    },
    activePlantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      default: undefined
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    siteCode: { type: String, enum: Object.values(SITE_CODES), default: SITE_CODES.HYDROPONIC, index: true },
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null
    },
    type: {
      type: String,
      enum: ['WATER'],
      default: 'WATER'
    },
    volume: {
      type: Number,
      required: true,
      min: 0
    },
    irrigationDeviceId: { type: String, default: null },
    activeIrrigationDeviceId: { type: String, default: undefined },
    irrigationNozzleNo: { type: Number, default: null, enum: [null, 1, 3, 4, 5, 6, 7, 8, 9] },
    irrigationOutletIndex: { type: Number, default: null, min: 0, max: 9 },
    irrigationPumpId: { type: Number, default: null, enum: [1, 2] },
    status: {
      type: String,
      enum: ['PENDING', 'DISPATCHED', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW', 'CANCELLED'],
      default: 'PENDING',
      index: true
    },
    dispatchedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    failureReason: { type: String, default: null, maxlength: 120 },
    executionUncertain: { type: Boolean, default: false },
    estimatedVolume: { type: Number, default: null, min: 0 }
  },
  { timestamps: true }
);

commandSchema.index({ plantId: 1, status: 1, createdAt: 1 });
commandSchema.index(
  { activePlantId: 1 },
  { unique: true, partialFilterExpression: { activePlantId: { $type: 'objectId' } } }
);
commandSchema.index({ irrigationDeviceId: 1, status: 1, dispatchedAt: 1 });
commandSchema.index(
  { activeIrrigationDeviceId: 1 },
  { unique: true, partialFilterExpression: { activeIrrigationDeviceId: { $type: 'string' } } }
);
commandSchema.index(
  { requestedBy: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

module.exports = mongoose.model('Command', commandSchema);
