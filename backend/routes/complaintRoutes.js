const express = require('express');
const router = express.Router();
const multer = require('multer');
const { createComplaint, getComplaints, updateComplaint, resetDatabase, generateReplyForTicket, translateComplaint, getComplaintStatus, submitFeedback, uploadResolutionPhoto, getNearbyComplaints, supportComplaint, classifyPhoto, mergeComplaint, addNote, bulkUpdate, eraseMyData } = require('../controllers/complaintController');
const { protect, admin } = require('../middleware/authMiddleware');
const rateLimit = require('../middleware/rateLimit');

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, 'uploads/');
  },
  filename(req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });
// Proof-of-fix photos: images only, at most 8 MB.
const imageUpload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)),
});

// Citizen (public) endpoints
router.post('/', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }), upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'image', maxCount: 1 }]), createComplaint);
router.post('/status', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }), getComplaintStatus);
// In-memory photo for the instant category hint (never stored).
const memoryImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) });
router.post('/classify-image', rateLimit({ windowMs: 60 * 1000, max: 20 }), memoryImage.single('image'), classifyPhoto);
router.get('/nearby', rateLimit({ windowMs: 60 * 1000, max: 30 }), getNearbyComplaints);
router.post('/support', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), supportComplaint);
router.post('/erase', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }), eraseMyData);
router.post('/feedback', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), submitFeedback);

// Officer endpoints
router.get('/', protect, getComplaints);
router.post('/bulk', protect, bulkUpdate);
router.delete('/reset', protect, admin, resetDatabase);
router.post('/:id/generate-reply', protect, generateReplyForTicket);
router.post('/:id/translate', protect, translateComplaint);
router.patch('/:id', protect, updateComplaint);
router.post('/:id/merge', protect, mergeComplaint);
router.post('/:id/notes', protect, addNote);
router.post('/:id/resolution-photo', protect, imageUpload.single('image'), uploadResolutionPhoto);

module.exports = router;
