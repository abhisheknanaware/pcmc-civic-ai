const mongoose = require('mongoose');

// One citizen chat conversation. Messages are stored PII-redacted and expire after 30 days.
const chatMessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  intent: String,
  topic: String,
  language: String,
  answered: Boolean,        // assistant: gave a grounded answer or completed the requested action
  sources: [String],        // knowledge-base document ids used
  ms: Number,               // assistant response time
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const chatSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  language: String,
  messages: [chatMessageSchema],
  complaintConverted: { type: Boolean, default: false },
  statusChecks: { type: Number, default: 0 },
  serviceClicks: { type: Number, default: 0 }
}, { timestamps: true });

chatSessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('ChatSession', chatSessionSchema);
