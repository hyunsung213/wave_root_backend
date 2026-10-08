const mongoose = require('mongoose');

const sensorSnapshotSchema = new mongoose.Schema(
  {
    plantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      required: true
    },
    degree: { type: Number, required: true, min: -50, max: 100 },
    moisture_air: { type: Number, required: true, min: 0, max: 100 },
    moisture_soil: { type: Number, required: true, min: 0, max: 4095 },
    rux: { type: Number, default: null, min: 0, max: 200000 },
    sampledAt: { type: Date, required: true }
  },
  { timestamps: true }
);

sensorSnapshotSchema.index({ plantId: 1 }, { unique: true });
sensorSnapshotSchema.index({ sampledAt: -1 });

module.exports = mongoose.model('SensorSnapshot', sensorSnapshotSchema);
