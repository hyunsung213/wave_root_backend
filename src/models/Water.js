const mongoose = require('mongoose');
const { SITE_CODES } = require('../config/farmSites');

const waterSchema = new mongoose.Schema(
  {
    plantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      required: true
    },
    volume: {
      type: Number,
      required: true,
      min: 0
    },
    siteCode: { type: String, enum: Object.values(SITE_CODES), default: SITE_CODES.HYDROPONIC },
    requestedVolume: { type: Number, default: null, min: 0 },
    measuredVolume: { type: Number, default: null, min: 0 },
    estimated: { type: Boolean, default: false },
    source: { type: String, enum: ['RDK_X5', 'RASPBERRY_PI', 'MANUAL'], default: 'RDK_X5' },
    deviceId: { type: String, default: null, trim: true, maxlength: 64 },
    commandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Command',
      default: null
    }
  },
  { timestamps: true }
);

waterSchema.index({ plantId: 1, createdAt: -1 });
waterSchema.index({ commandId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Water', waterSchema);
