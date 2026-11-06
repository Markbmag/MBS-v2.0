// mailer.js
const nodemailer = require('nodemailer');

const EXCHANGE_HOST      = process.env.EXCHANGE_HOST      || process.env.SMTP_HOST;
const EXCHANGE_USER      = process.env.EXCHANGE_USER      || process.env.SMTP_USER;
const EXCHANGE_PASS      = process.env.EXCHANGE_PASS      || process.env.SMTP_PASS;
const EXCHANGE_FROM      = process.env.EXCHANGE_FROM      || process.env.SMTP_FROM || EXCHANGE_USER;
const EXCHANGE_FROM_NAME = process.env.EXCHANGE_FROM_NAME || 'MBS Quality System';

// IT-спец дал только один, оставлю как базовый + пара фоллбэков
const PORT_CONFIGS = [
  { port: 25,   secure: false, requireTLS: false },
  { port: 46,  secure: false, requireTLS: true  },
  { port: 2525, secure: false, requireTLS: false },
];

if (!EXCHANGE_HOST || !EXCHANGE_USER || !EXCHANGE_PASS) {
  console.warn('[mailer] SMTP не сконфигурирован — письма отправляться не будут');
}

/**
 * Универсальная отправка.
 * @param {Object} opts
 * @param {string|string[]} opts.to
 * @param {string|string[]} [opts.cc]
 * @param {string} opts.subject
 * @param {string} [opts.text]
 * @param {string} [opts.html]
 * @param {Array}  [opts.attachments]  // [{ filename, content, contentType }]
 */
async function sendEmail(opts, maxRetries = 2, baseDelayMs = 20000) {
  const { to, cc, subject, text, html, attachments } = opts;

  if (!to || !subject) {
    console.error('[mailer] sendEmail: отсутствует to/subject');
    return false;
  }

  let lastError;
  let delay = baseDelayMs;

  for (const cfg of PORT_CONFIGS) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const transporter = nodemailer.createTransport({
          host: EXCHANGE_HOST,
          port: cfg.port,
          secure: cfg.secure,
          requireTLS: cfg.requireTLS,
          auth: { user: EXCHANGE_USER, pass: EXCHANGE_PASS },
          tls: { rejectUnauthorized: false },
          connectionTimeout: 10000,
          greetingTimeout:   10000,
          socketTimeout:     10000,
        });

        await transporter.sendMail({
          from: `"${EXCHANGE_FROM_NAME}" <${EXCHANGE_FROM}>`,
          to, cc, subject, text, html, attachments,
        });

        console.log(`[mailer] OK → ${to} (port ${cfg.port})`);
        return true;
      } catch (err) {
        lastError = err;

        if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKET' || err.code === 'ECONNREFUSED') {
          console.warn(`[mailer] port ${cfg.port} unreachable: ${err.message}`);
          break; // к следующему порту
        }
        if (err.responseCode >= 400 && err.responseCode < 500) {
          console.warn(`[mailer] временная ошибка ${cfg.port}: ${err.message}`);
          await new Promise(r => setTimeout(r, delay));
          delay *= 2;
          continue;
        }
        console.error(`[mailer] постоянная ошибка ${cfg.port}: ${err.message}`);
        break;
      }
    }
  }

  // NTLM-фоллбэк
  try {
    console.warn('[mailer] пробую NTLM на 587...');
    const transporter = nodemailer.createTransport({
      host: EXCHANGE_HOST,
      port: 587,
      secure: false,
      auth: { type: 'NTLM', user: EXCHANGE_USER, pass: EXCHANGE_PASS },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
    });

    await transporter.sendMail({
      from: `"${EXCHANGE_FROM_NAME}" <${EXCHANGE_FROM}>`,
      to, cc, subject, text, html, attachments,
    });

    console.log(`[mailer] OK → ${to} (NTLM)`);
    return true;
  } catch (err) {
    console.error('[mailer] NTLM не сработал:', err.message);
  }

  console.error(`[mailer] всё провалилось → ${to}. Last:`, lastError?.message);
  return false;
}

module.exports = { sendEmail, EXCHANGE_FROM, EXCHANGE_FROM_NAME };