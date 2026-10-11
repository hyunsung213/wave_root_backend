const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  productId: { type: String, required: true, maxlength: 40 },
  productName: { type: String, required: true, maxlength: 100 },
  plantName: { type: String, required: true, trim: true, maxlength: 60 },
  productPrice: { type: Number, required: true, min: 0 },
  passPrice: { type: Number, required: true, min: 0 },
  subtotal: { type: Number, required: true, min: 0 },
  couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
  couponCode: { type: String, default: null },
  discountAmount: { type: Number, required: true, min: 0, default: 0 },
  amountDue: { type: Number, required: true, min: 0 },
  depositorName: { type: String, required: true, trim: true, maxlength: 80 },
  depositDetails: {
    bankName: { type: String, default: null },
    accountNumber: { type: String, default: null },
    accountHolder: { type: String, default: null }
  },
  status: { type: String, enum: ['pending', 'confirming', 'confirmed', 'cancelled'], default: 'pending', index: true },
  confirmedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  couponReservationActive: { type: Boolean, default: false },
  plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', default: null }
}, { timestamps: true });

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);