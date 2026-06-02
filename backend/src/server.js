/**
 * Ravi Anshu Portfolio — Backend Server
 *
 * Endpoints:
 *   GET  /health         — health check
 *   POST /api/contact    — contact form, sends email via SMTP
 *
 * Environment variables (see .env.example):
 *   PORT               — server port (default 3000)
 *   SMTP_HOST          — SMTP hostname (e.g. smtp.gmail.com)
 *   SMTP_PORT          — SMTP port (e.g. 587)
 *   SMTP_USER          — SMTP username / sender email
 *   SMTP_PASS          — SMTP password / app password
 *   CONTACT_TO_EMAIL   — recipient email (defaults to SMTP_USER)
 *   FRONTEND_URL       — allowed CORS origin (e.g. https://yourdomain.com)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// CORS — allow your deployed frontend origin, or * for dev
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5500']
  : ['*'];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// Rate limiting — 5 contact submissions per 15 min per IP
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' }
});

// ─── Serve frontend (when deploying as one unit) ──────────────────────────────

// If you place your index.html in ../frontend, the backend will serve it too.
// Comment this out if you host frontend separately (Netlify, Vercel, etc.).
const frontendPath = path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(frontendPath));

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Email helper ─────────────────────────────────────────────────────────────

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465', // true for 465, false for 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

const SUBJECT_LABELS = {
  collaboration: 'Collaboration',
  research: 'Research Project',
  job: 'Job Opportunity',
  other: 'Other'
};

// ─── Validation helper ────────────────────────────────────────────────────────

function validateContactBody(body) {
  const errors = [];
  const { name, email, subject, message } = body;

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('name must be at least 2 characters');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('valid email is required');
  }
  if (!message || typeof message !== 'string' || message.trim().length < 10) {
    errors.push('message must be at least 10 characters');
  }
  if (subject && !Object.keys(SUBJECT_LABELS).includes(subject)) {
    errors.push('invalid subject value');
  }
  // Basic spam guard — no URLs in name field
  if (name && /https?:\/\//i.test(name)) {
    errors.push('name field cannot contain URLs');
  }
  return errors;
}

// ─── Contact route ────────────────────────────────────────────────────────────

app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const errors = validateContactBody(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('. ') });
    }

    const { name, email, subject = 'other', message } = req.body;
    const subjectLabel = SUBJECT_LABELS[subject] || 'Other';
    const toEmail = process.env.CONTACT_TO_EMAIL || process.env.SMTP_USER;

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      // No SMTP configured — log and return success (useful during local dev)
      console.log('──────────────────────────────────────────────────');
      console.log('[CONTACT FORM] No SMTP configured. Would have sent:');
      console.log(`  From   : ${name} <${email}>`);
      console.log(`  Subject: [Portfolio] ${subjectLabel}`);
      console.log(`  Message: ${message}`);
      console.log('──────────────────────────────────────────────────');
      return res.json({ success: true, message: 'Message received (email not configured).' });
    }

    const transporter = createTransporter();

    // Email to Ravi
    await transporter.sendMail({
      from: `"Portfolio Contact" <${process.env.SMTP_USER}>`,
      to: toEmail,
      replyTo: `"${name}" <${email}>`,
      subject: `[Portfolio] ${subjectLabel} from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\nSubject: ${subjectLabel}\n\n${message}`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;color:#111">
          <h2 style="margin:0 0 16px;color:#0a0a0a">New message from your portfolio</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600;width:100px">Name</td><td style="padding:8px 12px">${escapeHtml(name)}</td></tr>
            <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Email</td><td style="padding:8px 12px"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
            <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Subject</td><td style="padding:8px 12px">${escapeHtml(subjectLabel)}</td></tr>
          </table>
          <h3 style="margin:0 0 8px">Message</h3>
          <p style="line-height:1.7;white-space:pre-wrap">${escapeHtml(message)}</p>
        </div>
      `
    });

    // Auto-reply to sender
    await transporter.sendMail({
      from: `"Ravi Anshu" <${process.env.SMTP_USER}>`,
      to: `"${name}" <${email}>`,
      subject: `Got your message, ${name.split(' ')[0]}!`,
      text: `Hi ${name},\n\nThanks for reaching out! I received your message and will get back to you soon.\n\n— Ravi Anshu\nhttps://github.com/Ravianshu19`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;color:#111">
          <h2 style="color:#0a0a0a">Thanks for reaching out!</h2>
          <p>Hi ${escapeHtml(name.split(' ')[0])},</p>
          <p>I received your message and will get back to you as soon as I can.</p>
          <p style="color:#555">— Ravi Anshu</p>
          <a href="https://github.com/Ravianshu19" style="color:#888;font-size:12px">github.com/Ravianshu19</a>
        </div>
      `
    });

    return res.json({ success: true, message: 'Message sent successfully!' });

  } catch (err) {
    console.error('[Contact API Error]', err.message);
    return res.status(500).json({ error: 'Failed to send message. Please try emailing directly.' });
  }
});

// ─── Catch-all — serve frontend for client-side routing ──────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'), (err) => {
    if (err) res.status(404).json({ error: 'Not found' });
  });
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error(err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✓ Portfolio backend running on http://localhost:${PORT}`);
  if (!process.env.SMTP_USER) {
    console.warn('⚠  SMTP not configured — contact form will log to console only');
  }
});

// ─── Util ─────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
