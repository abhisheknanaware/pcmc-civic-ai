const express = require('express');
const { sendMessage, checkStatus, trackEvent } = require('../controllers/chatController');
const rateLimit = require('../middleware/rateLimit');

const router = express.Router();

// Public citizen assistant; limits protect the shared local LLM from abuse.
router.post('/message', rateLimit({ windowMs: 60 * 1000, max: 12, message: 'Too many messages. Please wait a minute.' }), sendMessage);
router.post('/status', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }), checkStatus);
router.post('/event', rateLimit({ windowMs: 60 * 1000, max: 60 }), trackEvent);

module.exports = router;
