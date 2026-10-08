const express = require('express');
const { listDocuments, reviewDocument, unansweredQuestions } = require('../controllers/kbController');
const { protect, admin } = require('../middleware/authMiddleware');

const router = express.Router();

// Officers can see the chatbot's sources and gaps; only admins can change what it answers from.
router.get('/documents', protect, listDocuments);
router.patch('/documents/:id', protect, admin, reviewDocument);
router.get('/unanswered', protect, unansweredQuestions);

module.exports = router;
