const mongoose = require('mongoose');

const logSchema = new mongoose.Schema(
  {
    plantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      required: true
    },
    degree: { type: Number, required: true, min: -50, max: 100 },
    moisture_soil: { type: Number, required: true, min: 0, max: 4095 },
    moisture_air: { type: Number, required: true, min: 0, max: 100 },
    rux: { type: Number, default: null, min: 0, max: 200000 }
  },
  { timestamps: true }
);

logSchema.index({ plantId: 1, createdAt: -1 });

module.exports = mongoose.model('Log', logSchema);
