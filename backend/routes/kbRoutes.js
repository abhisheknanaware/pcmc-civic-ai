const express = require('express');
const {
  listDocuments, reviewDocument, unansweredQuestions, listAnswers, saveAnswer, deleteAnswer,
} = require('../controllers/kbController');
const { protect, admin } = require('../middleware/authMiddleware');

const router = express.Router();

// Officers can see the chatbot's sources and gaps; only admins can change what it answers from.
router.get('/documents', protect, listDocuments);
router.patch('/documents/:id', protect, admin, reviewDocument);
router.get('/unanswered', protect, unansweredQuestions);
router.get('/answers', protect, listAnswers);
router.post('/answers', protect, admin, saveAnswer);
router.delete('/answers/:id', protect, admin, deleteAnswer);

module.exports = router;
