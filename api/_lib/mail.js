/* ===========================================================================
   EMAIL
   The Contact form's one outgoing message: a reader's question, to whoever
   maintains this tool. Sent through Resend's HTTPS API, so there is no SDK
   and no new dependency — one fetch with a bearer token.

     RESEND_API_KEY   the key from resend.com (API Keys). Without it the form
                      falls back to the reader's own email program.
     CONTACT_TO       who receives the questions, one address or a comma-
                      separated list. Optional: without it the address set at
                      /admin → Content → Contact (as published) is used.
     CONTACT_FROM     the sender, on a domain verified at Resend, e.g.
                      "TAS Decision Tree <contact@your-tribe.org>". Without a
                      verified domain Resend only accepts its test sender,
                      onboarding@resend.dev, which delivers to the Resend
                      account's own address and nowhere else.

   The recipient is never taken from the request. A form that let the
   browser say where its mail goes would be a relay for anyone's spam.
   ========================================================================= */
import { unavailable, upstreamFailed } from './http.js';

const RESEND_URL = 'https://api.resend.com/emails';
const TEST_SENDER = 'TAS Decision Tree <onboarding@resend.dev>';
/* Hobby functions stop at 10 seconds; leave room to answer the reader. */
const SEND_TIMEOUT_MS = 7000;

export function mailConfigured() {
  return !!String(process.env.RESEND_API_KEY || '').trim();
}

export function mailFrom() {
  return String(process.env.CONTACT_FROM || '').trim() || TEST_SENDER;
}

/* `to` is a list of addresses already checked by the caller. */
export async function sendMail({ to, replyTo, subject, html, text }) {
  const key = String(process.env.RESEND_API_KEY || '').trim();
  if (!key) {
    throw unavailable('mail_unconfigured', 'Email is not set up on this deployment yet.');
  }
  let res;
  try {
    res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: mailFrom(),
        to,
        reply_to: replyTo || undefined,
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    console.error('[mail] could not reach the provider:', err.name, err.message);
    throw upstreamFailed(
      'mail_failed',
      'The email service did not answer. Try again in a moment, or use Copy and send it from your own email.'
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    /* the provider's reason goes to the logs, where the site owner can act
       on it; the reader gets a sentence they can act on */
    console.error('[mail] the provider refused the message:', res.status, body.slice(0, 300));
    throw upstreamFailed(
      'mail_failed',
      'The message could not be sent just now. Try again in a moment, or use Copy and send it from your own email.'
    );
  }
}
