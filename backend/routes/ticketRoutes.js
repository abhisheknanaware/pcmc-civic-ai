const express = require('express');
const router = express.Router();
const { getTickets, getTicketById, updateTicketStatus, assignTicket, addAgentNote } = require('../controllers/ticketController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', getTickets);
router.get('/:id', getTicketById);
router.put('/:id/status', updateTicketStatus);
router.put('/:id/assign', assignTicket);
router.post('/:id/note', addAgentNote);

module.exports = router;
