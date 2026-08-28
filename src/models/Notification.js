const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    notifyAt: {
      type: Date,
      required: true,
      default: Date.now
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    type: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 40
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000
    },
    isRead: {
      type: Boolean,
      default: false
    },
    readAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, notifyAt: -1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
