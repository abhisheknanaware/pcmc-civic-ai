const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const complaintRoutes = require('./routes/complaintRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const metaRoutes = require('./routes/metaRoutes');
const chatRoutes = require('./routes/chatRoutes');

const app = express();
// Behind nginx (Docker), use the client's address from X-Forwarded-For so rate limits stay per citizen.
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/kb', require('./routes/kbRoutes'));
app.use('/api/staff', require('./routes/staffRoutes'));

// Basic route
app.get('/', (req, res) => {
  res.send('PCMC Civic AI API is running');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong on the server' });
});

module.exports = app;
