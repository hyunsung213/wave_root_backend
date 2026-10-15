const mongoose = require('mongoose');

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
    irrigationDeviceId: { type: String, default: null, trim: true, maxlength: 64 },
    irrigationOutletIndex: { type: Number, default: null, min: 0, max: 9 },
    irrigationPumpId: { type: Number, default: null, enum: [1, 2] },
    irrigationEnabled: { type: Boolean, default: false }
  },
  { timestamps: true }
);

plantSchema.index({ orderId: 1 }, { unique: true, sparse: true });
plantSchema.index(
  { irrigationDeviceId: 1, irrigationOutletIndex: 1 },
  { unique: true, partialFilterExpression: { irrigationEnabled: true } }
);

module.exports = mongoose.model('Plant', plantSchema);
