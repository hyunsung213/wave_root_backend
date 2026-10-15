const mongoose = require('mongoose');

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
    estimated: { type: Boolean, default: false },
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
