const Complaint = require('../models/Complaint');
const Ticket = require('../models/Ticket');
const ChatSession = require('../models/ChatSession');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const llmService = require('../services/llmService');
const { sanitizePii } = require('../services/piiRedaction');
const { pcmc, ZONE_IDS } = require('../services/pcmcConfig');
const { nextTicketNumber, normalizeTicketNumber } = require('../services/ticketNumbers');
const notifications = require('../services/notifications');
const cloudinary = require('cloudinary').v2;
const exifr = require('exifr');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_SECRET_KEY
});

const CLOSED_STATUSES = ['RESOLVED', 'CLOSED'];

// Status timeline for the citizen. Complaints filed before history was recorded get a reconstructed one.
const timeline = (c) => {
  if (c.history?.length) return c.history.map(({ event, at }) => ({ event, at }));
  const steps = [{ event: 'OPEN', at: c.createdAt }];
  if (c.status && c.status !== 'OPEN') steps.push({ event: c.status, at: c.resolvedAt || c.updatedAt });
  return steps;
};

// Feedback is asked once per resolution: after a reopen and a new resolution, the citizen can answer again.
const canGiveFeedback = (c) => CLOSED_STATUSES.includes(c.status)
  && (!c.feedback?.at || (c.resolvedAt && new Date(c.feedback.at) < new Date(c.resolvedAt)));

// What a citizen may see about their own complaint (no officer notes, duplicates, AI drafts or other citizens' data).
const citizenView = (c) => ({
  timeline: timeline(c),
  feedback: c.feedback?.at ? { resolved: c.feedback.resolved, rating: c.feedback.rating, at: c.feedback.at } : undefined,
  canGiveFeedback: canGiveFeedback(c),
  reopenCount: c.reopenCount || 0,
  ticketNumber: c.ticketNumber,
  status: c.status,
  category: c.category,
  department: c.department,
  zone: c.zone,
  ward: c.ward,
  priority: c.priority,
  slaDeadline: c.slaDeadline,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
  resolvedAt: c.resolvedAt,
  finalReply: ['RESOLVED', 'CLOSED'].includes(c.status) ? c.finalReply : undefined,
  // The citizen's own photo, and the officer's proof-of-fix photo once the complaint is resolved.
  imageUrl: c.imageUrl || undefined,
  resolutionImageUrl: CLOSED_STATUSES.includes(c.status) ? c.resolutionImageUrl || undefined : undefined,
});
exports.citizenView = citizenView;

// Ask the NLP service which category a photo shows (CLIP). Returns null if unavailable.
async function classifyImage(buffer, type = 'image/jpeg') {
  try {
    const form = new FormData();
    form.append('image', new Blob([buffer], { type }), 'photo.jpg');
    const nlpBase = new URL(process.env.NLP_SERVICE_URL || 'http://localhost:8000/process').origin;
    const response = await fetch(`${nlpBase}/classify-image`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    return response.ok ? await response.json() : null;
  } catch (error) {
    console.error('Photo classification failed:', error.message);
    return null;
  }
}

// POST /api/complaints/classify-image (public) — instant "looks like: Road & Potholes" hint on the report form.
exports.classifyPhoto = async (req, res) => {
  if (!req.file?.buffer?.length) return res.status(400).json({ message: 'Please choose an image.' });
  const result = await classifyImage(req.file.buffer, req.file.mimetype);
  if (!result) return res.status(502).json({ message: 'Could not analyse the photo.' });
  res.json(result);
};

// Target response times per priority live in config/pcmc.json (also shown on the homepage).
const calculateSLA = (priority) => {
  const hoursToAdd = pcmc.slaHours[priority] || pcmc.slaHours.P3;
  return new Date(Date.now() + hoursToAdd * 60 * 60 * 1000);
};

exports.createComplaint = async (req, res) => {
  try {
    const { name, email, orderId, complaint, location, latitude, longitude, zone, chatSessionId } = req.body;
    const fromChat = typeof chatSessionId === 'string' && /^[\w-]{8,64}$/.test(chatSessionId);
    // Zone chosen by the citizen on the form; otherwise the NLP derives it from an explicit ward number.
    const citizenZone = ZONE_IDS.includes(zone) ? zone : null;

    if (!name || !email) {
       return res.status(400).json({ message: 'Name and email are required.'});
    }
    if (!complaint && (!req.files || (!req.files['audio'] && !req.files['image']))) {
       return res.status(400).json({ message: 'Please provide either text complaint, audio, or image.'});
    }

    let imageUrl = null;
    let imageBuffer = null; // kept in memory for the photo classifier; the file itself is deleted after upload
    let exifLat = null;
    let exifLng = null;

    if (req.files && req.files['image'] && req.files['image'][0]) {
       const imagePath = req.files['image'][0].path;

       // Try to extract GPS from EXIF metadata
       try {
         const gps = await exifr.gps(imagePath);
         if (gps && gps.latitude && gps.longitude) {
           exifLat = gps.latitude;
           exifLng = gps.longitude;
           console.log(`Extracted EXIF GPS: ${exifLat}, ${exifLng}`);
         }
       } catch (exifErr) {
         console.log("Could not extract EXIF data:", exifErr.message);
       }

       imageBuffer = fs.readFileSync(imagePath);
       const result = await cloudinary.uploader.upload(imagePath, { folder: 'pmc_complaints' });
       imageUrl = result.secure_url;
       fs.unlinkSync(imagePath); // remove from local
    }

    // Determine final coordinates (prefer EXIF over Browser GPS)
    const finalLat = exifLat !== null ? exifLat : (latitude ? parseFloat(latitude) : null);
    const finalLng = exifLng !== null ? exifLng : (longitude ? parseFloat(longitude) : null);

    // 1. Initial quick save to DB with raw data
    console.log("Saving initial Complaint to DB...");
    const newComplaint = await Complaint.create({
      ticketNumber: await nextTicketNumber(),
      source: fromChat ? 'chatbot' : 'form',
      userName: name,
      userEmail: email,
      orderId: orderId || '',
      originalText: complaint || 'Audio uploaded',
      sanitizedText: 'Processing...', // Temporary
      category: 'Processing...',
      subcategory: 'Processing...',
      language: 'Processing...',
      sentiment: 'Processing...',
      urgency: 'Medium',
      priority: 'P4',
      department: 'Processing...',
      ward: 'Processing...',
      zone: citizenZone,
      location: {
        address: location || '',
        latitude: finalLat,
        longitude: finalLng
      },
      imageUrl,
      status: 'OPEN',
      history: [{ event: 'OPEN' }],
      generatedReply: ""
    });

    if (fromChat) {
      ChatSession.updateOne({ sessionId: chatSessionId }, { complaintConverted: true }).catch(() => {});
    }

    // 2. Process Heavy AI Tasks synchronously
    try {
      // Prepare data for NLP service
      const nlpData = new FormData();
      if (complaint) nlpData.append('text', complaint);
      if (req.files && req.files['audio'] && req.files['audio'][0]) nlpData.append('audio', fs.createReadStream(req.files['audio'][0].path));

      console.log("Calling NLP Service...");
      let nlpResult = {};
      try {
        const nlpResponse = await axios.post(process.env.NLP_SERVICE_URL, nlpData, {
          headers: nlpData.getHeaders()
        });
        nlpResult = nlpResponse.data;
      } catch (nlpError) {
        console.error("NLP Service Error:", nlpError.message);
        nlpResult = {
          category: 'Other / General',
          subcategory: 'General inquiry',
          categoryConfidence: 0,
          subcategoryConfidence: 0,
          sanitizedText: complaint || 'Audio uploaded',
          language: 'English',
          sentiment: 'Neutral',
          urgency: 'Medium',
          priority: 'P3',
          department: pcmc.defaultDepartment,
          ward: 'Unknown Ward',
          entities: {}
        };
      }

      // Photo-only complaints (or text the classifier could not place) take their category from the photo.
      const weakText = !complaint || nlpResult.category === 'Other / General' || (nlpResult.categoryConfidence ?? 1) < 0.3;
      if (imageBuffer && weakText) {
        const fromPhoto = await classifyImage(imageBuffer);
        if (fromPhoto?.category && fromPhoto.confidence >= 0.5 && pcmc.categoryRouting[fromPhoto.category]) {
          nlpResult.category = fromPhoto.category;
          nlpResult.categoryConfidence = fromPhoto.confidence;
          nlpResult.department = pcmc.categoryRouting[fromPhoto.category].department;
          console.log(`Category from photo: ${fromPhoto.category} (${fromPhoto.confidence})`);
        }
      }

      const sanitizedText = sanitizePii(nlpResult.sanitizedText || complaint || 'Audio uploaded', { name, email });
      const finalOrderId = orderId || (nlpResult.entities && nlpResult.entities.order_id) || '';

      // Update DB with NLP results
      const finalComplaint = await Complaint.findByIdAndUpdate(newComplaint._id, {
        orderId: finalOrderId,
        sanitizedText,
        category: nlpResult.category,
        subcategory: nlpResult.subcategory,
        categoryConfidence: nlpResult.categoryConfidence,
        subcategoryConfidence: nlpResult.subcategoryConfidence,
        language: nlpResult.language,
        sentiment: nlpResult.sentiment,
        urgency: nlpResult.urgency,
        priority: nlpResult.priority,
        department: nlpResult.department,
        ward: nlpResult.ward,
        wardNumber: nlpResult.wardNumber || undefined,
        zone: citizenZone || nlpResult.zone || undefined,
        'location.locality': nlpResult.entities?.locality,
        'location.pincode': nlpResult.entities?.pincode,
        slaDeadline: calculateSLA(nlpResult.priority),
        entities: nlpResult.entities
      }, { new: true });

      // 3. Check for duplicates
      try {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

        const recentComplaints = await Complaint.find({
          _id: { $ne: newComplaint._id },
          status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
          // Compare within the same zone when known; the text similarity check does the rest.
          ...(finalComplaint.zone ? { zone: finalComplaint.zone } : {}),
          department: nlpResult.department,
          category: nlpResult.category,
          createdAt: { $gte: twoDaysAgo }
        });

        if (recentComplaints.length > 0) {
           const existing_complaints = recentComplaints.map(c => ({
             id: c._id.toString(),
             text: c.originalText
           }));

           const dupResponse = await axios.post('http://localhost:8000/check-duplicates', {
             new_text: finalComplaint.originalText,
             existing_complaints
           });

           if (dupResponse.data.duplicates && dupResponse.data.duplicates.length > 0) {
             const duplicates = dupResponse.data.duplicates.map(d => ({
               complaintId: d.id,
               score: d.score
             }));
             await Complaint.findByIdAndUpdate(newComplaint._id, { duplicates });
             finalComplaint.duplicates = duplicates;
           }
        }
      } catch (err) {
        console.error("Duplicate checking failed:", err.message);
      }

      console.log("NLP processing complete for ticket:", newComplaint._id);

      // 3. Return success to frontend
      res.status(201).json({
        message: 'Complaint submitted successfully.',
        complaint: citizenView(finalComplaint)
      });

      prepareAiDrafts(newComplaint._id);
      notifications.complaintReceived(finalComplaint);

    } catch (processError) {
      console.error("Processing Error:", processError);
      // Even if NLP fails, we already saved the initial complaint, so return success
      res.status(201).json({
        message: 'Complaint submitted successfully.',
        complaint: citizenView(newComplaint)
      });
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error processing complaint' });
  }
};

exports.getComplaints = async (req, res) => {
  try {
    // Department officers only see their own department's queue; admins see everything.
    const scope = req.user.role !== 'admin' && req.user.department ? { department: req.user.department } : {};
    const complaints = await Complaint.find(scope).sort({ createdAt: -1 });
    res.json(complaints);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateComplaint = async (req, res) => {
  try {
    const { id } = req.params;
    const { sendEmail } = req.body;
    // Only these fields are editable by officers; ticket numbers, citizen details and AI outputs are not.
    const EDITABLE = ['status', 'priority', 'department', 'finalReply', 'zone', 'wardNumber'];
    const updateData = Object.fromEntries(Object.entries(req.body).filter(([key]) => EDITABLE.includes(key)));
    if ('zone' in updateData && updateData.zone !== null && !ZONE_IDS.includes(updateData.zone)) {
      return res.status(400).json({ message: 'Invalid zone.' });
    }

    const existing = await Complaint.findById(id).select('status resolvedAt createdAt history');
    if (!existing) return res.status(404).json({ message: 'Complaint not found' });

    const statusChanged = Boolean(updateData.status) && updateData.status !== existing.status;
    const update = { $set: updateData };
    if (statusChanged) {
      // Record when a ticket is first closed so management analytics can measure resolution time.
      const isClosed = CLOSED_STATUSES.includes(updateData.status);
      if (isClosed && !existing.resolvedAt) updateData.resolvedAt = new Date();
      if (!isClosed) updateData.resolvedAt = null;
      // Complaints filed before history was recorded get their "Reported" step first.
      const seed = existing.history?.length ? [] : [{ event: 'OPEN', at: existing.createdAt }];
      update.$push = { history: { $each: [...seed, { event: updateData.status, at: new Date() }] } };
    }

    const updatedComplaint = await Complaint.findByIdAndUpdate(id, update, { new: true });

    // One email per save: the officer's reply (with the new status) or, without a reply, the status change alone.
    const reply = sendEmail && updatedComplaint.finalReply ? updatedComplaint.finalReply : null;
    let email = { sent: false };
    if (reply || statusChanged) {
      email = await notifications.statusChanged(updatedComplaint, statusChanged ? updatedComplaint.status : null, reply);
    }
    res.json({
      ...updatedComplaint.toObject(),
      emailSent: email.sent,
      ...(reply && !email.sent ? { emailError: email.reason === 'email_not_configured'
        ? 'Ticket updated. Email is not configured yet (set EMAIL_USER / EMAIL_PASSWORD in backend/.env).'
        : 'Ticket updated, but the email could not be sent. Please check the Gmail credentials in backend/.env.' } : {}),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------- Nearby complaints and "Me too" (public) ----------
const crypto = require('crypto');
const NEARBY_RADIUS_M = 500;
const distanceM = (lat1, lng1, lat2, lng2) => {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
};
const supporterHash = (email) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'pcmc-civic')
  .update(String(email).trim().toLowerCase()).digest('hex');

// GET /api/complaints/nearby?lat=&lng= — open complaints within 500 m. Category, status and an approximate
// (~100 m) position only: no text, names, photos or exact addresses.
exports.getNearbyComplaints = async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ message: 'Valid lat and lng are required.' });
  }
  try {
    const dLat = NEARBY_RADIUS_M / 111320;
    const dLng = NEARBY_RADIUS_M / (111320 * Math.cos((lat * Math.PI) / 180));
    const candidates = await Complaint.find({
      status: { $nin: CLOSED_STATUSES },
      category: { $ne: 'Processing...' },
      'location.latitude': { $gte: lat - dLat, $lte: lat + dLat },
      'location.longitude': { $gte: lng - dLng, $lte: lng + dLng },
    }).select('ticketNumber category status supportCount createdAt location.latitude location.longitude').limit(100);
    const nearby = candidates
      .map((c) => ({ c, d: distanceM(lat, lng, c.location.latitude, c.location.longitude) }))
      .filter(({ d }) => d <= NEARBY_RADIUS_M)
      .sort((a, b) => a.d - b.d)
      .slice(0, 10)
      .map(({ c, d }) => ({
        ticketNumber: c.ticketNumber, category: c.category, status: c.status, createdAt: c.createdAt,
        distanceM: Math.round(d / 10) * 10, affected: (c.supportCount || 0) + 1,
        lat: Math.round(c.location.latitude * 1000) / 1000, lng: Math.round(c.location.longitude * 1000) / 1000,
      }));
    res.json({ nearby });
  } catch (error) {
    res.status(500).json({ message: 'Could not look up nearby complaints.' });
  }
};

// POST /api/complaints/support { ticketNumber, email } — "this affects me too", once per email.
exports.supportComplaint = async (req, res) => {
  const ticketNumber = normalizeTicketNumber(req.body?.ticketNumber);
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!ticketNumber || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'A ticket number and a valid email are required.' });
  }
  try {
    const complaint = await Complaint.findOne({ ticketNumber }).select('userEmail status supporters supportCount');
    if (!complaint || CLOSED_STATUSES.includes(complaint.status)) return res.status(404).json({ message: 'This complaint is not open any more.' });
    if (complaint.userEmail.trim().toLowerCase() === email) return res.status(409).json({ message: 'own_complaint' });
    const emailHash = supporterHash(email);
    // Atomic: only adds the vote if this email has not supported the complaint before.
    const updated = await Complaint.findOneAndUpdate(
      { _id: complaint._id, 'supporters.emailHash': { $ne: emailHash } },
      { $push: { supporters: { emailHash } }, $inc: { supportCount: 1 } },
      { new: true, projection: { supportCount: 1 } });
    if (!updated) return res.status(409).json({ message: 'already_supported', affected: (complaint.supportCount || 0) + 1 });
    res.json({ ticketNumber, affected: updated.supportCount + 1 });
  } catch (error) {
    res.status(500).json({ message: 'Could not record your support.' });
  }
};

// Officer uploads an "after" photo as proof of the fix (Cloudinary, like citizen photos).
exports.uploadResolutionPhoto = async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Please choose an image file.' });
  try {
    const complaint = await Complaint.findById(req.params.id).select('department');
    if (!complaint) return res.status(404).json({ message: 'Complaint not found' });
    if (req.user.role !== 'admin' && req.user.department && complaint.department !== req.user.department) {
      return res.status(403).json({ message: 'This complaint belongs to another department.' });
    }
    const result = await cloudinary.uploader.upload(file.path, { folder: 'pmc_resolutions' });
    const updated = await Complaint.findByIdAndUpdate(req.params.id,
      { resolutionImageUrl: result.secure_url, resolutionImageAt: new Date() }, { new: true });
    res.json(updated);
  } catch (error) {
    console.error('Resolution photo upload failed:', error.message);
    res.status(502).json({ message: 'Could not upload the photo. Please try again.' });
  } finally {
    fs.promises.unlink(file.path).catch(() => {});
  }
};

exports.resetDatabase = async (req, res) => {
  try {
    await Complaint.deleteMany({});
    res.json({ message: 'Database cleared successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const GENERATING = 'Generating smart reply...';

// Everything the LLM may see: structured fields plus PII-free text, never the raw complaint.
const replyContext = (complaint) => ({
  category: complaint.category,
  language: complaint.language,
  sentiment: complaint.sentiment,
  urgency: complaint.urgency,
  department: complaint.department,
  ward: complaint.ward,
  slaDeadline: complaint.slaDeadline,
  sanitizedText: sanitizePii(
    complaint.sanitizedText && complaint.sanitizedText !== 'Processing...' ? complaint.sanitizedText : complaint.originalText,
    { name: complaint.userName, email: complaint.userEmail }
  ),
});

const needsTranslation = (complaint) => complaint.language && !['English', 'Unknown', 'Processing...'].includes(complaint.language);

// Runs after the citizen already has their response: drafts the reply in the citizen's language
// (and an English translation for officers) so both are ready before an officer opens the ticket.
const prepareAiDrafts = async (complaintId) => {
  try {
    const complaint = await Complaint.findById(complaintId);
    if (!complaint || complaint.finalReply) return;
    await Complaint.findByIdAndUpdate(complaintId, { generatedReply: GENERATING });
    // Translation first: the officer needs to understand the complaint before reviewing a reply.
    if (needsTranslation(complaint)) {
      const translatedText = await llmService.translateToEnglish(replyContext(complaint).sanitizedText);
      await Complaint.findByIdAndUpdate(complaintId, { translatedText });
    }
    const { reply, language } = await llmService.generateSmartReply(replyContext(complaint));
    await Complaint.findOneAndUpdate({ _id: complaintId, generatedReply: GENERATING }, { generatedReply: reply, replyLanguage: language });
  } catch (error) {
    console.error('Background AI drafting failed:', error.message);
    await Complaint.findOneAndUpdate({ _id: complaintId, generatedReply: GENERATING }, { generatedReply: '' }).catch(() => {});
  }
};
exports.prepareAiDrafts = prepareAiDrafts;

/**
 * Body: { language: 'auto' | 'English' | 'Hindi' | 'Marathi' | 'Hinglish', regenerate?: boolean, stream?: boolean }
 * With stream=true the response is NDJSON: {"token": "..."} lines ({"reset": true} means discard tokens so far),
 * then {"done": true, "generatedReply", "replyLanguage"}.
 */
exports.generateReplyForTicket = async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ message: 'Complaint not found' });

    const { language = 'auto', regenerate = false, stream = false } = req.body || {};
    const write = (payload) => res.write(`${JSON.stringify(payload)}\n`);
    if (stream) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.flushHeaders();
    }

    const started = Date.now();
    const { reply, language: replyLanguage, fallback } = await llmService.generateSmartReply(replyContext(complaint), {
      language,
      regenerate,
      onToken: stream ? (token) => write({ token }) : undefined,
      onReset: stream ? () => write({ reset: true }) : undefined,
    });

    complaint.generatedReply = reply;
    complaint.replyLanguage = replyLanguage;
    await complaint.save();

    const result = { done: true, generatedReply: reply, replyLanguage, fallback, ms: Date.now() - started };
    if (stream) {
      write(result);
      return res.end();
    }
    res.json(result);
  } catch (error) {
    console.error("Error generating reply manually:", error);
    if (res.headersSent) {
      res.write(`${JSON.stringify({ error: 'Failed to generate AI reply' })}\n`);
      return res.end();
    }
    res.status(500).json({ message: 'Failed to generate AI reply' });
  }
};

exports.translateComplaint = async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ message: 'Complaint not found' });
    complaint.translatedText = await llmService.translateToEnglish(replyContext(complaint).sanitizedText);
    await complaint.save();
    res.json({ translatedText: complaint.translatedText });
  } catch (error) {
    console.error('Error translating complaint:', error);
    res.status(500).json({ message: 'Failed to translate complaint' });
  }
};

// Public: a citizen looks up their own complaint with the ticket number AND the email used to file it.
exports.getComplaintStatus = async (req, res) => {
  const ticketNumber = normalizeTicketNumber(req.body?.ticketNumber);
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!ticketNumber || !email) {
    return res.status(400).json({ message: 'Ticket number and email are required.' });
  }
  try {
    const complaint = await Complaint.findOne({ ticketNumber });
    // Same response whether the ticket is missing or the email doesn't match, so tickets can't be probed.
    if (!complaint || complaint.userEmail.trim().toLowerCase() !== email) {
      return res.status(404).json({ message: 'No complaint found for this ticket number and email.' });
    }
    res.json(citizenView(complaint));
  } catch (error) {
    res.status(500).json({ message: 'Could not look up the complaint.' });
  }
};

// Public: after resolution the citizen answers "Was this fixed?" (same ticket + email ownership check).
// "Not fixed" reopens the complaint with a fresh SLA deadline so it returns to the officer's queue.
exports.submitFeedback = async (req, res) => {
  const ticketNumber = normalizeTicketNumber(req.body?.ticketNumber);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const resolved = req.body?.resolved;
  const rating = req.body?.rating == null ? undefined : Number(req.body.rating);
  if (!ticketNumber || !email || typeof resolved !== 'boolean') {
    return res.status(400).json({ message: 'Ticket number, email and an answer are required.' });
  }
  if (rating !== undefined && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
    return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
  }
  try {
    const complaint = await Complaint.findOne({ ticketNumber });
    if (!complaint || complaint.userEmail.trim().toLowerCase() !== email) {
      return res.status(404).json({ message: 'No complaint found for this ticket number and email.' });
    }
    if (!canGiveFeedback(complaint)) {
      return res.status(409).json({ message: 'Feedback can be given once the complaint is resolved.' });
    }

    const comment = sanitizePii(String(req.body?.comment || '').trim().slice(0, 500), { name: complaint.userName, email: complaint.userEmail });
    complaint.feedback = { resolved, rating, comment: comment || undefined, at: new Date() };
    if (!resolved) {
      complaint.status = 'OPEN';
      complaint.resolvedAt = null;
      complaint.slaDeadline = calculateSLA(complaint.priority);
      complaint.slaBreached = false;
      complaint.reopenCount = (complaint.reopenCount || 0) + 1;
      if (!complaint.history.length) complaint.history.push(...timeline(complaint));
      complaint.history.push({ event: 'REOPENED', at: new Date() });
    }
    await complaint.save();
    if (!resolved) notifications.statusChanged(complaint, 'REOPENED');
    res.json({ reopened: !resolved, complaint: citizenView(complaint) });
  } catch (error) {
    console.error('Feedback error:', error.message);
    res.status(500).json({ message: 'Could not save your feedback.' });
  }
};
