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
