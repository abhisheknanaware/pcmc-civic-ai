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
const emailService = require('../services/emailService');
const cloudinary = require('cloudinary').v2;
const exifr = require('exifr');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_SECRET_KEY
});

// What a citizen may see about their own complaint (no officer notes, duplicates, AI drafts or other citizens' data).
const citizenView = (c) => ({
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
});
exports.citizenView = citizenView;

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

    // Record when a ticket is first closed so management analytics can measure resolution time.
    if (updateData.status) {
      const isClosed = ['RESOLVED', 'CLOSED'].includes(updateData.status);
      const existing = await Complaint.findById(id).select('resolvedAt');
      if (isClosed && !existing?.resolvedAt) updateData.resolvedAt = new Date();
      if (!isClosed) updateData.resolvedAt = null;
    }

    // Allow updating status, priority, department, finalReply, etc.
    const updatedComplaint = await Complaint.findByIdAndUpdate(id, updateData, { new: true });

    if (!updatedComplaint) {
      return res.status(404).json({ message: 'Complaint not found' });
    }

    // Send email if requested
    if (sendEmail && updatedComplaint.userEmail && updatedComplaint.finalReply) {
      console.log("Sending email via Nodemailer...");
      try {
        await emailService.sendEmail(
          updatedComplaint.userEmail,
          `PCMC Complaint ${updatedComplaint.ticketNumber || updatedComplaint._id.toString().slice(-6)} Update`,
          updatedComplaint.finalReply
        );
      } catch (emailError) {
        console.error("Failed to send email to customer:", emailError);
        return res.status(200).json({
          ...updatedComplaint.toObject(),
          emailSent: false,
          emailError: 'Ticket updated, but failed to send email. Please check your Gmail credentials in .env.'
        });
      }
      return res.json({ ...updatedComplaint.toObject(), emailSent: true });
    }

    res.json({ ...updatedComplaint.toObject(), emailSent: false });
  } catch (error) {
    res.status(500).json({ message: error.message });
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
