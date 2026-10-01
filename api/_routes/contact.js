/* GET  /api/contact   can this deployment send the Contact form by email
   POST /api/contact   send a reader's question to whoever maintains the tool

   The reader gives a question, an email address and a phone number (a name
   too, if they like), and may include their answers from the tree. It goes
   out as one email, laid out to be read and answered: the question first,
   then who asked and how to reach them, then where in the tree they were.
   Reply-To is the reader, so answering it reaches them directly.

   Guarded the way a form anyone can reach has to be:
     - the recipient comes from configuration (mail.js), never the request,
       so this cannot be pointed at someone else's inbox;
     - a hidden field a person never fills in catches simple bots, which are
       told it worked;
     - sends are limited per client address and per day for the deployment,
       counted in the database the way sign-in attempts are, and only sends
       that went out count. Without a database a per-instance count stands
       in, which is weaker, and the README says so.
   ========================================================================= */
import { json, readJson, route, str, bad, tooMany, unavailable, clientIp } from '../_lib/http.js';
import { checkEmail, normaliseEmail, ipKey, reserveAttempt, settleAttempt } from '../_lib/auth.js';
import { isConfigured, one } from '../_lib/db.js';
import { mailConfigured, sendMail } from '../_lib/mail.js';

const PER_ADDRESS_PER_HOUR = 5;
const DAILY_DEFAULT = 100;
function dailyCap() {
  const n = parseInt(String(process.env.TAS_CONTACT_PER_DAY || ''), 10);
  return n >= 1 && n <= 10000 ? n : DAILY_DEFAULT;
}

/* CONTACT_TO, or else the address the editor published under Contact. */
async function recipients() {
  const listed = String(process.env.CONTACT_TO || '')
    .split(/[,;]/)
    .map((s) => normaliseEmail(s))
    .filter((s) => s && !checkEmail(s));
  if (listed.length) return listed.slice(0, 5);
  if (!isConfigured()) return [];
  try {
    const row = await one(
      `select data->'CONTACT'->>'email' as email from site_tree where id = $1`,
      ['current']
    );
    const e = normaliseEmail(row && row.email);
    return e && !checkEmail(e) ? [e] : [];
  } catch (err) {
    console.error('[contact] could not read the published contact address:', err.message);
    return [];
  }
}

/* ---- the rate limit, without a database ---------------------------------- */
const memory = new Map();
function memoryLimit(key, max, windowMs) {
  const now = Date.now();
  const hits = (memory.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    const wait = Math.ceil((windowMs - (now - hits[0])) / 1000);
    throw tooMany('Too many messages from here. Try again in about ' + Math.ceil(wait / 60) + ' minutes.', wait);
  }
  hits.push(now);
  memory.set(key, hits);
}

/* ---- the message ----------------------------------------------------------- */
function h(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

function compose({ name, email, phone, question, answers, result, origin }) {
  const who = name || email;
  const sent = new Date().toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'UTC',
  }) + ' UTC';
  const telHref = 'tel:' + phone.replace(/[^\d+]/g, '');
  const subject = oneLine('Question from ' + who + ' — TAS Decision Tree').slice(0, 180);

  const row = (k, v) =>
    '<tr><td style="padding:6px 12px 6px 0;color:#6b6457;font-family:Arial,Helvetica,sans-serif;font-size:13px;vertical-align:top;white-space:nowrap">' +
    k +
    '</td><td style="padding:6px 0;font-size:15px;color:#1d2a30">' +
    v +
    '</td></tr>';
  let html =
    '<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f3f1ec">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2ddd3;border-radius:10px;font-family:Georgia,\'Times New Roman\',serif;color:#1d2a30">' +
    '<tr><td style="padding:22px 28px 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#7a6f5d">TAS Decision Tree · Contact form</td></tr>' +
    '<tr><td style="padding:2px 28px 14px;font-size:22px;font-weight:bold;line-height:1.3">A question from ' + h(who) + '</td></tr>' +
    '<tr><td style="padding:0 28px 16px;font-size:15px;line-height:1.6">Hello,<br><br>' + h(who) +
    ' asked the question below through the TAS Decision Tree and would like a reply. Replying to this email answers them directly.</td></tr>' +
    '<tr><td style="padding:0 28px 18px"><div style="background:#f7f5f0;border-left:4px solid #2f5d62;border-radius:4px;padding:14px 16px;font-size:15px;line-height:1.6;white-space:pre-wrap">' +
    h(question) +
    '</div></td></tr>' +
    '<tr><td style="padding:0 28px 18px"><table role="presentation" cellpadding="0" cellspacing="0">' +
    (name ? row('Name', h(name)) : '') +
    row('Email', '<a href="mailto:' + h(email) + '" style="color:#2f5d62">' + h(email) + '</a>') +
    row('Phone', '<a href="' + h(telHref) + '" style="color:#2f5d62">' + h(phone) + '</a>') +
    row('Sent', h(sent)) +
    '</table></td></tr>';
  if (answers.length || result) {
    html +=
      '<tr><td style="padding:0 28px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#7a6f5d">Their answers in the tree</td></tr>' +
      '<tr><td style="padding:0 28px 18px;font-size:14px;line-height:1.55"><ul style="margin:0;padding-left:20px">' +
      answers.map((a) => '<li>' + h(a) + '</li>').join('') +
      '</ul>' +
      (result ? '<p style="margin:10px 0 0"><b>Result:</b> ' + h(result) + '</p>' : '') +
      '</td></tr>';
  }
  html +=
    '<tr><td style="padding:14px 28px 22px;border-top:1px solid #ece8e0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#7a6f5d">' +
    'Sent from the contact form' + (origin ? ' at ' + h(origin) : '') + ', when the reader pressed Send. ' +
    'The TAS Decision Tree is general information to support a discussion, not legal advice and not an official EPA product.' +
    '</td></tr></table></td></tr></table></body></html>';

  const NL = '\n';
  let text =
    'A question from ' + who + ', sent through the TAS Decision Tree.' + NL +
    'Replying to this email answers them directly.' + NL + NL +
    question + NL + NL +
    (name ? 'Name:  ' + name + NL : '') +
    'Email: ' + email + NL +
    'Phone: ' + phone + NL +
    'Sent:  ' + sent + NL;
  if (answers.length || result) {
    text += NL + 'Their answers in the tree:' + NL + answers.map((a) => '  - ' + a).join(NL) + NL;
    if (result) text += 'Result: ' + result + NL;
  }
  text += NL + '—' + NL + 'Sent from the contact form' + (origin ? ' at ' + origin : '') + '.' + NL;
  return { subject, html, text };
}

export default route({
  async GET(_req, res) {
    const on = mailConfigured() && (await recipients()).length > 0;
    json(res, 200, { email: on });
  },

  async POST(req, res) {
    const body = (await readJson(req)) || {};
    /* the field a person never sees: whatever filled it is told it worked */
    if (str(body.website, { max: 200 })) {
      json(res, 200, { ok: true });
      return;
    }
    const name = oneLine(str(body.name, { max: 120 }));
    const email = normaliseEmail(str(body.email, { max: 254 }));
    const phone = oneLine(str(body.phone, { max: 40 }));
    const question = str(body.question, { max: 5000 });

    const fields = {};
    if (question.length < 5) fields.question = 'Write your question.';
    else if (question.length > 4000) fields.question = 'Keep it under 4,000 characters.';
    const e = checkEmail(email);
    if (e) fields.email = e;
    const digits = phone.replace(/\D/g, '');
    if (!phone) fields.phone = 'Enter a phone number.';
    else if (!/^[+()\d\s.\-]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
      fields.phone = 'That does not look like a phone number.';
    }
    if (Object.keys(fields).length) throw bad('invalid', 'Check the fields marked below.', { fields });

    const to = await recipients();
    if (!mailConfigured() || !to.length) {
      throw unavailable(
        'mail_unconfigured',
        'Email is not set up on this deployment yet. Use Copy, and send it from your own email.'
      );
    }

    const answers = (Array.isArray(body.answers) ? body.answers : [])
      .slice(0, 40)
      .map((a) => oneLine(str(a, { max: 300 })))
      .filter(Boolean);
    const result = oneLine(str(body.result, { max: 200 }));
    const origin = /^https?:\/\/[^\s"<>]+$/i.test(String(req.headers.origin || ''))
      ? String(req.headers.origin)
      : '';

    const ip = ipKey(clientIp(req));
    let ticket = null;
    if (isConfigured()) {
      ticket = await reserveAttempt([
        { key: 'contact:' + ip, max: PER_ADDRESS_PER_HOUR, windowMin: 60, counts: 'all' },
        { key: 'contact:all', max: dailyCap(), windowMin: 1440, counts: 'all' },
      ]);
    } else {
      memoryLimit('contact:' + ip, PER_ADDRESS_PER_HOUR, 3600_000);
      memoryLimit('contact:all', dailyCap(), 86400_000);
    }

    const msg = compose({ name, email, phone, question, answers, result, origin });
    try {
      await sendMail({ to, replyTo: email, ...msg });
    } catch (err) {
      await settleAttempt(ticket, false);
      throw err;
    }
    await settleAttempt(ticket, true);
    json(res, 200, { ok: true });
  },
});
