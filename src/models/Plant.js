const mongoose = require('mongoose');
const { SITE_CODES } = require('../config/farmSites');

const plantSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: undefined
    },
    siteCode: {
      type: String,
      enum: Object.values(SITE_CODES),
      default: SITE_CODES.HYDROPONIC,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60
    },
    type: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    growthTargetDays: {
      type: Number,
      default: 60,
      min: 1,
      max: 3650,
      validate: {
        validator: (value) => Number.isInteger(value),
        message: 'growthTargetDays must be an integer between 1 and 3650.'
      }
    },
    rdkCameraId: {
      type: String,
      default: null,
      trim: true,
      maxlength: 64
    },
    rdkZone: {
      type: Number,
      default: null,
      min: 1,
      max: 144,
      validate: {
        validator: (value) => value === null || Number.isInteger(value),
        message: 'rdkZone must be an integer between 1 and 144.'
      }
    },
    streamGatewayId: { type: String, default: null, trim: true, maxlength: 64 },
    streamCameraId: { type: String, default: null, trim: true, maxlength: 64 },
    streamZone: { type: Number, default: null, min: 1, max: 144,
      validate: { validator: (value) => value === null || Number.isInteger(value), message: 'streamZone must be an integer.' } },
    irrigationDeviceId: { type: String, default: null, trim: true, maxlength: 64 },
    irrigationNozzleNo: { type: Number, default: null, enum: [null, 1, 3, 4, 5, 6, 7, 8, 9] },
    // Deprecated 0..9 index retained for old records only; Y-Farm never dispatches it.
    irrigationOutletIndex: { type: Number, default: null, min: 0, max: 9 },
    irrigationPumpId: { type: Number, default: null, enum: [1, 2] },
    irrigationEnabled: { type: Boolean, default: false }
  },
  { timestamps: true }
);

plantSchema.index({ orderId: 1 }, { unique: true, sparse: true });
plantSchema.index({ siteCode: 1, streamGatewayId: 1, streamCameraId: 1, streamZone: 1 }, {
  unique: true,
  partialFilterExpression: { streamGatewayId: { $type: 'string' }, streamCameraId: { $type: 'string' }, streamZone: { $type: 'number' } }
});
plantSchema.index(
  { irrigationDeviceId: 1, irrigationOutletIndex: 1 },
  { unique: true, partialFilterExpression: { irrigationEnabled: true } }
);
plantSchema.index(
  { irrigationDeviceId: 1, irrigationNozzleNo: 1 },
  { unique: true, partialFilterExpression: { irrigationEnabled: true, irrigationNozzleNo: { $type: 'number' } } }
);

module.exports = mongoose.model('Plant', plantSchema);
