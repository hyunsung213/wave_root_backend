const mongoose = require('mongoose');

const logSchema = new mongoose.Schema(
  {
    plantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      required: true
    },
    degree: { type: Number, required: true },
    moisture_soil: { type: Number, required: true },
    moisture_air: { type: Number, required: true },
    rux: { type: Number, default: null }
  },
  { timestamps: true }
);

logSchema.index({ plantId: 1, createdAt: -1 });

module.exports = mongoose.model('Log', logSchema);
