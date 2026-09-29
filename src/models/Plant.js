const mongoose = require('mongoose');

const plantSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
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
    streamingPort: {
      type: Number,
      default: 5000,
      min: 1,
      max: 65535,
      validate: {
        validator: (value) => value === null || Number.isInteger(value),
        message: 'streamingPort must be an integer between 1 and 65535.'
      }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Plant', plantSchema);
