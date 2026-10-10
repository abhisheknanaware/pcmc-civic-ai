const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
  let decoded;
  try {
    decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
  } catch (error) {
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
  }
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized, account no longer exists' });
  }
  // A password change signs out every older session.
  if (req.user.passwordChangedAt && decoded.iat * 1000 < req.user.passwordChangedAt.getTime()) {
    return res.status(401).json({ message: 'Your password was changed. Please sign in again.' });
  }
  next();
};

const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized as an admin' });
  }
};

module.exports = { protect, admin };
