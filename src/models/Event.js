const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema(
  {
    plantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      required: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000
    },
    imageUrl: {
      type: String,
      default: null,
      trim: true
    },
    eventDate: {
      type: Date,
      required: true,
      default: Date.now
    }
  },
  { timestamps: true }
);

eventSchema.index({ plantId: 1, eventDate: -1, createdAt: -1 });

module.exports = mongoose.model('Event', eventSchema);
