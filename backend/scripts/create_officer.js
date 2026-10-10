// Creates or updates an officer account. Usage:
//   node scripts/create_officer.js <email> <password> "<name>" [admin|agent] ["<department>"]
// A department restricts an agent to that department's complaints; admins see everything.
require('dotenv').config();
const { passwordProblem } = require('../services/passwordPolicy');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const { pcmc } = require('../services/pcmcConfig');

(async () => {
  const [email, password, name, role = 'agent', department] = process.argv.slice(2);
  if (!email || !password || !name) {
    console.error('Usage: node scripts/create_officer.js <email> <password> "<name>" [admin|agent] ["<department>"]');
    process.exit(1);
  }
  const problem = passwordProblem(password, email);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  if (department && !pcmc.departments.some((d) => d.id === department)) {
    console.error(`Unknown department. Use one of: ${pcmc.departments.map((d) => d.id).join(', ')}`);
    process.exit(1);
  }
  await connectDB();
  const user = (await User.findOne({ email })) || new User({ email });
  Object.assign(user, { name, password, role, department: department || undefined });
  await user.save();
  console.log(`${role} account ready: ${email}${department ? ` (${department})` : ''}`);
  await mongoose.disconnect();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
