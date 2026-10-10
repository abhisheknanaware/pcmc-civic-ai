const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['agent', 'admin'],
    default: 'agent'
  },
  // Agents with a department only see that department's complaints; admins see all.
  department: { type: String },
  // Sessions issued before this moment are rejected (set when the password changes).
  passwordChangedAt: { type: Date },
  // Brute-force protection: 5 wrong passwords lock the account for 15 minutes.
  failedLogins: { type: Number, default: 0 },
  lockUntil: { type: Date }
}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);
});

userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
