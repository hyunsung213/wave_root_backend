const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'A valid email address is required.']
    },
    phone: {
      type: String,
      trim: true,
      default: null
    },
    pwd: {
      type: String,
      required: function requiredPassword() {
        return !this.isSocial;
      },
      select: false
    },
    isSocial: {
      type: Boolean,
      default: false
    },
    passwordChangedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.pwd;
    delete ret.passwordChangedAt;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);
