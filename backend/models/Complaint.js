const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema({
  // Citizen-facing reference, e.g. "PCMC-100007".
  ticketNumber: { type: String, unique: true, sparse: true },
  // Where the complaint came from: the web form directly, or the citizen assistant's "Register complaint".
  source: { type: String, enum: ['form', 'chatbot'], default: 'form' },
  userName: {
    type: String,
    required: true
  },
  userEmail: {
    type: String,
    required: true
  },
  orderId: {
    type: String
  },
  originalText: {
    type: String,
    required: true
  },
  sanitizedText: {
    type: String
  },
  audioUrl: {
    type: String
  },
  category: {
    type: String
  },
  subcategory: {
    type: String
  },
  categoryConfidence: {
    type: Number
  },
  subcategoryConfidence: {
    type: Number
  },
  language: {
    type: String
  },
  sentiment: {
    type: String
  },
  urgency: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Critical']
  },
  priority: {
    type: String,
    enum: ['P1', 'P2', 'P3', 'P4']
  },
  department: {
    type: String
  },
  ward: {
    type: String
  },
  // PCMC prabhag (1-32) and zonal office letter (A-L); see config/pcmc.json.
  wardNumber: { type: Number },
  zone: { type: String },
  location: {
    address: String,
    locality: String,
    landmark: String,
    road: String,
    pincode: String,
    latitude: Number,
    longitude: Number
  },
  entities: {
    type: mongoose.Schema.Types.Mixed
  },
  slaDeadline: { type: Date },
  slaBreached: { type: Boolean, default: false },
  resolvedAt: { type: Date },
  duplicates: [{
    complaintId: { type: mongoose.Schema.Types.ObjectId, ref: 'Complaint' },
    score: Number
  }],
  imageUrl: { type: String },
  // "After" photo uploaded by the officer as proof that the issue was fixed.
  resolutionImageUrl: { type: String },
  resolutionImageAt: { type: Date },
  status: {
    type: String,
    enum: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'],
    default: 'OPEN'
  },
  generatedReply: {
    type: String
  },
  replyLanguage: { type: String },
  // English translation of a Hindi/Marathi/Hinglish complaint (PII-free), for officers.
  translatedText: { type: String },
  finalReply: {
    type: String
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Every status change (and citizen reopening), shown to the citizen as a timeline.
  history: [{
    _id: false,
    event: { type: String, enum: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED', 'REOPENED'] },
    at: { type: Date, default: Date.now },
  }],
  // The citizen's answer to "Was this fixed?" after resolution. "Not fixed" reopens the complaint.
  feedback: {
    resolved: Boolean,
    rating: { type: Number, min: 1, max: 5 },
    comment: { type: String, maxlength: 500 },
    at: Date,
  },
  reopenCount: { type: Number, default: 0 },
  // "Me too": other citizens affected by the same issue. Emails are stored only as salted hashes (to stop double votes).
  supporters: [{ _id: false, emailHash: String, at: { type: Date, default: Date.now } }],
  supportCount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Complaint', complaintSchema);
