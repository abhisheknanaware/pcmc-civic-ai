const emailService = require('./emailService');

// Citizen emails for complaint milestones, in the complaint's language. Sending is skipped (not an error)
// until real Gmail credentials are set in backend/.env, so the app works without email configured.
const TRACK_URL = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/track`;
const HELPLINE = '8888006666';

const emailConfigured = () => {
  const user = process.env.EMAIL_USER || '';
  const pass = emailService.smtpPassword();
  return /@/.test(user) && !/^your/i.test(user) && pass.length >= 8 && !/^your/i.test(pass);
};

const STATUS_TEXT = {
  English: {
    ASSIGNED: 'has been assigned to an officer', IN_PROGRESS: 'is being worked on', WAITING_FOR_CUSTOMER: 'needs more information from you',
    RESOLVED: 'has been marked as resolved', CLOSED: 'has been closed', REOPENED: 'has been reopened',
  },
  Hindi: {
    ASSIGNED: 'एक अधिकारी को सौंपी गई है', IN_PROGRESS: 'पर काम चल रहा है', WAITING_FOR_CUSTOMER: 'के लिए आपसे और जानकारी चाहिए',
    RESOLVED: 'हल कर दी गई है', CLOSED: 'बंद कर दी गई है', REOPENED: 'फिर से खोली गई है',
  },
  Marathi: {
    ASSIGNED: 'अधिकाऱ्याकडे सोपवण्यात आली आहे', IN_PROGRESS: 'वर काम सुरू आहे', WAITING_FOR_CUSTOMER: 'साठी तुमच्याकडून अधिक माहिती हवी आहे',
    RESOLVED: 'सोडवण्यात आली आहे', CLOSED: 'बंद करण्यात आली आहे', REOPENED: 'पुन्हा उघडण्यात आली आहे',
  },
};

const TEMPLATES = {
  English: {
    receivedSubject: (t) => `PCMC complaint ${t} received`,
    received: (c, t) => `Dear ${c.userName},\n\nYour complaint has been registered with Pimpri-Chinchwad Municipal Corporation.\n\nTicket number: ${t}\nCategory: ${c.category}\nDepartment: ${c.department}\n\nKeep this ticket number to track your complaint: ${TRACK_URL}`,
    updateSubject: (t) => `PCMC complaint ${t} update`,
    update: (c, t, status) => `Dear ${c.userName},\n\nYour complaint ${t} ${status}.`,
    reply: 'Message from PCMC:',
    feedback: `Was your issue fixed? Tell us on the tracking page: ${TRACK_URL}`,
    track: `Track your complaint: ${TRACK_URL}`,
    footer: `For help, call the Sarathi helpline ${HELPLINE}.\n\n- PCMC Civic`,
  },
  Hindi: {
    receivedSubject: (t) => `PCMC शिकायत ${t} प्राप्त हुई`,
    received: (c, t) => `प्रिय ${c.userName},\n\nआपकी शिकायत पिंपरी-चिंचवड महानगरपालिका में दर्ज हो गई है।\n\nटिकट नंबर: ${t}\nश्रेणी: ${c.category}\nविभाग: ${c.department}\n\nशिकायत की स्थिति देखने के लिए यह टिकट नंबर संभालकर रखें: ${TRACK_URL}`,
    updateSubject: (t) => `PCMC शिकायत ${t} अपडेट`,
    update: (c, t, status) => `प्रिय ${c.userName},\n\nआपकी शिकायत ${t} ${status}।`,
    reply: 'PCMC का संदेश:',
    feedback: `क्या आपकी समस्या हल हुई? ट्रैकिंग पेज पर बताएं: ${TRACK_URL}`,
    track: `अपनी शिकायत देखें: ${TRACK_URL}`,
    footer: `सहायता के लिए सारथी हेल्पलाइन ${HELPLINE} पर कॉल करें।\n\n- PCMC Civic`,
  },
  Marathi: {
    receivedSubject: (t) => `PCMC तक्रार ${t} प्राप्त झाली`,
    received: (c, t) => `प्रिय ${c.userName},\n\nतुमची तक्रार पिंपरी-चिंचवड महानगरपालिकेकडे नोंदवली गेली आहे.\n\nटिकट क्रमांक: ${t}\nश्रेणी: ${c.category}\nविभाग: ${c.department}\n\nतक्रारीची स्थिती पाहण्यासाठी हा टिकट क्रमांक जपून ठेवा: ${TRACK_URL}`,
    updateSubject: (t) => `PCMC तक्रार ${t} अपडेट`,
    update: (c, t, status) => `प्रिय ${c.userName},\n\nतुमची तक्रार ${t} ${status}.`,
    reply: 'PCMC चा संदेश:',
    feedback: `तुमची समस्या सुटली का? ट्रॅकिंग पानावर सांगा: ${TRACK_URL}`,
    track: `तुमची तक्रार पहा: ${TRACK_URL}`,
    footer: `मदतीसाठी सारथी हेल्पलाईन ${HELPLINE} वर कॉल करा.\n\n- PCMC Civic`,
  },
};

const languageOf = (c) => (TEMPLATES[c.language] ? c.language : 'English');
const ticketOf = (c) => c.ticketNumber || c._id.toString().slice(-6);

async function send(complaint, subject, body) {
  if (!emailConfigured() || !complaint.userEmail) return { sent: false, reason: 'email_not_configured' };
  try {
    await emailService.sendEmail(complaint.userEmail, subject, body);
    return { sent: true };
  } catch (error) {
    console.error('Citizen notification failed:', error.message);
    return { sent: false, reason: 'send_failed' };
  }
}

// "We received your complaint" with the ticket number, after classification has filled in category/department.
exports.complaintReceived = (complaint) => {
  const t = TEMPLATES[languageOf(complaint)];
  const ticket = ticketOf(complaint);
  return send(complaint, t.receivedSubject(ticket), `${t.received(complaint, ticket)}\n\n${t.footer}`);
};

// Status change, optionally carrying the officer's reply. Resolved complaints also ask for feedback.
exports.statusChanged = (complaint, event, reply) => {
  const language = languageOf(complaint);
  const t = TEMPLATES[language];
  const ticket = ticketOf(complaint);
  const status = STATUS_TEXT[language][event];
  const parts = [status ? t.update(complaint, ticket, status) : `${t.updateSubject(ticket)}.`];
  if (reply) parts.push(`${t.reply}\n${reply}`);
  parts.push(['RESOLVED', 'CLOSED'].includes(event) ? t.feedback : t.track, t.footer);
  return send(complaint, t.updateSubject(ticket), parts.join('\n\n'));
};

exports.emailConfigured = emailConfigured;
