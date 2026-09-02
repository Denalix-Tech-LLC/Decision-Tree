/* ===========================================================================
   SIGN IN WITH GOOGLE
   The ordinary OAuth 2.0 authorization-code flow, by hand: no SDK, no extra
   dependency, about a hundred lines. Two environment variables switch it on,
   and when they are absent the button is not offered and these routes answer
   plainly that it is not configured — a deployment that wants only email and
   password is a supported deployment.

   On verifying the id_token: it is read here without checking its signature,
   because it was not handed to us by a browser. It comes back over TLS
   directly from Google's token endpoint, in a response to a request carrying
   our client secret, which is the channel Google itself says makes signature
   verification unnecessary. The claims inside are still checked — issuer,
   audience, expiry, and that Google says the address is verified — because a
   claim that fails those is wrong whatever signed it.
   ========================================================================= */
import crypto from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  return { clientId, clientSecret, enabled: !!(clientId && clientSecret) };
}

export function isGoogleEnabled() {
  return googleConfig().enabled;
}

/* The redirect URI has to match one registered in the Google console exactly.
   It is derived from the request so preview deployments work without a second
   variable, and GOOGLE_REDIRECT_URI overrides it when the public URL is not
   the one the function sees (a proxy, a custom domain in front). */
function redirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto =
    String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() ||
    (req.socket && req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${host}/api/auth/google/callback`;
}

export function authorizeUrl({ req, state, nonce }) {
  const { clientId } = googleConfig();
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    /* No refresh token is asked for: this tool never acts on someone's Google
       account, it only wants to know who they are, once, at sign-in. */
    prompt: 'select_account',
    include_granted_scopes: 'true',
  });
  return AUTH_URL + '?' + p.toString();
}

export async function exchangeCode(req, code) {
  const { clientId, clientSecret } = googleConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(req),
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!res.ok || !data || !data.id_token) {
    const why = (data && (data.error_description || data.error)) || text.slice(0, 200);
    const err = new Error('Google would not exchange that sign-in: ' + why);
    err.code = 'google_exchange_failed';
    throw err;
  }
  return data;
}

function decodeSegment(seg) {
  return JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

export function readIdToken(idToken, { nonce } = {}) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) {
    const e = new Error('Google returned a token this tool could not read.');
    e.code = 'google_bad_token';
    throw e;
  }
  let claims;
  try {
    claims = decodeSegment(parts[1]);
  } catch {
    const e = new Error('Google returned a token this tool could not read.');
    e.code = 'google_bad_token';
    throw e;
  }
  const fail = (msg) => {
    const e = new Error(msg);
    e.code = 'google_rejected';
    throw e;
  };
  const { clientId } = googleConfig();
  if (!ISSUERS.has(claims.iss)) fail('That sign-in did not come from Google.');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) fail('That sign-in was issued for a different application.');
  if (!claims.exp || claims.exp * 1000 < Date.now() - 60_000) fail('That sign-in has expired. Try again.');
  if (nonce && claims.nonce !== nonce) fail('That sign-in did not match the one this page started.');
  if (!claims.sub) fail('Google did not say who signed in.');
  if (!claims.email) fail('That Google account has no email address on it.');
  /* An unverified address must not be able to take over an account that was
     registered with a password on the same address. */
  if (claims.email_verified === false || claims.email_verified === 'false') {
    fail('Google has not verified that address, so it cannot be used to sign in here.');
  }
  return {
    sub: String(claims.sub),
    email: String(claims.email).toLowerCase(),
    name: String(claims.name || claims.given_name || ''),
    picture: String(claims.picture || ''),
  };
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/* state, nonce and where to go afterwards, in one short-lived cookie. The
   state is what makes the callback unforgeable; the nonce ties the id_token
   to this attempt; `next` is a path on this site and is checked as one. */
export function packFlow(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}
export function unpackFlow(value) {
  try {
    const o = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

/* Only a path on this site, never an absolute URL and never a protocol-
   relative one — an open redirect on a sign-in route is how a phishing page
   borrows someone else's domain. */
export function safeNext(next) {
  const s = String(next || '');
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\')) return '/';
  if (s.length > 300) return '/';
  return s;
}
