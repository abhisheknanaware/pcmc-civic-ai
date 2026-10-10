const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const jwt = require('jsonwebtoken');
const { passwordProblem } = require('../services/passwordPolicy');
const { logAudit } = require('../services/audit');

// Short sessions: an officer signs in again after a working day (configurable).
const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

exports.registerUser = async (req, res) => {
  const { name, email, password, role, department } = req.body;
  const problem = passwordProblem(password, email);
  if (problem) return res.status(400).json({ message: problem });

  try {
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await User.create({ name, email, password, role: role === 'admin' ? 'admin' : 'agent', department });
    logAudit(req, 'auth.officer_created', user.email, { role: user.role, department: user.department });
    res.status(201).json({ _id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.loginUser = async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const { password } = req.body || {};

  try {
    const user = await User.findOne({ email });
    if (user?.lockUntil && user.lockUntil > new Date()) {
      logAudit(req, 'auth.login_locked', email, { actor: email });
      const minutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(423).json({ message: `Too many wrong passwords. Try again in ${minutes} minute(s).` });
    }
    if (user && (await user.matchPassword(password))) {
      if (user.failedLogins || user.lockUntil) await User.updateOne({ _id: user._id }, { failedLogins: 0, $unset: { lockUntil: 1 } });
      logAudit({ ...req, user: { email: user.email, role: user.role } }, 'auth.login', user.email);
      return res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        token: generateToken(user._id),
        weakPassword: Boolean(passwordProblem(password, user.email)),
      });
    }
    if (user) {
      const failed = (user.failedLogins || 0) + 1;
      await User.updateOne({ _id: user._id }, failed >= MAX_FAILED
        ? { failedLogins: 0, lockUntil: new Date(Date.now() + LOCK_MINUTES * 60000) }
        : { failedLogins: failed });
    }
    logAudit(req, 'auth.login_failed', email, { actor: email });
    res.status(401).json({ message: 'Invalid email or password' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -failedLogins -lockUntil');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PUT /api/auth/password { currentPassword, newPassword } — signs out every other session.
exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  try {
    const user = await User.findById(req.user.id);
    if (!user || !(await user.matchPassword(currentPassword))) {
      logAudit(req, 'auth.password_change_failed', req.user.email);
      return res.status(400).json({ message: 'Your current password is not correct.' });
    }
    const problem = passwordProblem(newPassword, user.email);
    if (problem) return res.status(400).json({ message: problem });
    if (await user.matchPassword(newPassword)) return res.status(400).json({ message: 'The new password must be different from the current one.' });
    user.password = newPassword;
    await user.save();
    logAudit(req, 'auth.password_changed', user.email);
    res.json({ message: 'Password changed.', token: generateToken(user._id) });
  } catch (error) {
    res.status(500).json({ message: 'Could not change the password.' });
  }
};

// GET /api/auth/audit?limit=100&action=... — activity log (admins only).
exports.getAuditLog = async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const filter = req.query.action ? { action: { $regex: `^${String(req.query.action).replace(/[^\w.]/g, '')}` } } : {};
  const entries = await AuditLog.find(filter).sort({ at: -1 }).limit(limit).lean();
  res.json({ entries });
};
