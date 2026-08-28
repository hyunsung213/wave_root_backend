const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    growthRecordCount: { type: Number, default: 0, min: 0 },
    liveStreamViewCount: { type: Number, default: 0, min: 0 },
    waterCount: { type: Number, default: 0, min: 0 },
    harvestCount: { type: Number, default: 0, min: 0 },
    lastGrowthRecordAt: { type: Date, default: null },
    lastLiveStreamViewAt: { type: Date, default: null },
    lastWaterAt: { type: Date, default: null },
    lastHarvestAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('UserActivity', userActivitySchema);
