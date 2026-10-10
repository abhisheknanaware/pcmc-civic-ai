const mongoose = require('mongoose');

// Field staff who do the work on the ground (they do not log in). Officers assign tickets to them.
const fieldWorkerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  phone: { type: String, trim: true, maxlength: 20 },
  department: { type: String, required: true },
  zone: { type: String },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('FieldWorker', fieldWorkerSchema);
