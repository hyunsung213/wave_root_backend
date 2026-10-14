const mongoose = require('mongoose');

const alertSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true, immutable: true },
  signupAlerts: { type: Boolean, default: true },
  orderAlerts: { type: Boolean, default: true },
  cameraAlerts: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('AlertSettings', alertSettingsSchema);