require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const { warmUp } = require('./services/llmService');
const { backfillTicketNumbers } = require('./services/ticketNumbers');

const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
  await backfillTicketNumbers();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    warmUp();
  });
}).catch(err => {
  console.error('Database connection failed', err);
});
