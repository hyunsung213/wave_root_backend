const mongoose = require('mongoose');

const commandSchema = new mongoose.Schema(
  {
    plantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      required: true,
      index: true
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
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
    status: {
      type: String,
      enum: ['PENDING', 'DISPATCHED', 'COMPLETED', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
      index: true
    },
    dispatchedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

commandSchema.index({ plantId: 1, status: 1, createdAt: 1 });

module.exports = mongoose.model('Command', commandSchema);
