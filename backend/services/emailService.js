const nodemailer = require('nodemailer');

// SMTP settings from backend/.env. EMAIL_PASS is still accepted for older .env files.
const smtpPassword = () => process.env.EMAIL_PASSWORD || process.env.EMAIL_PASS || '';

let transporter;
const getTransporter = () => {
  if (!transporter) {
    const port = Number(process.env.EMAIL_PORT) || 587;
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465, // 587 upgrades to TLS with STARTTLS
      auth: { user: process.env.EMAIL_USER, pass: smtpPassword() },
      // Fail fast on networks that block SMTP instead of hanging requests for two minutes.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporter;
};

exports.smtpPassword = smtpPassword;

exports.sendEmail = async (to, subject, text) => {
  try {
    const info = await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      text,
    });
    console.log('Email sent: ' + info.response);
    return info;
  } catch (error) {
    console.error('Error sending email:', error.message);
    throw error;
  }
};
