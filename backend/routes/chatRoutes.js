const express = require('express');
const multer = require('multer');
const { sendMessage, checkStatus, trackEvent, transcribe } = require('../controllers/chatController');
const rateLimit = require('../middleware/rateLimit');

const router = express.Router();
// Voice questions are kept in memory only (never written to disk here) and capped at 10 MB.
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Public citizen assistant; limits protect the shared local LLM from abuse.
router.post('/message', rateLimit({ windowMs: 60 * 1000, max: 12, message: 'Too many messages. Please wait a minute.' }), sendMessage);
router.post('/status', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }), checkStatus);
router.post('/event', rateLimit({ windowMs: 60 * 1000, max: 60 }), trackEvent);
router.post('/transcribe', rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Too many voice messages. Please wait a minute.' }), audioUpload.single('audio'), transcribe);

module.exports = router;
