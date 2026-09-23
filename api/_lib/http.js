/* ===========================================================================
   REQUEST PLUMBING
   Method routing, JSON in and out, cookies, and the two checks that stand
   between a logged-in browser and a page on another origin: a same-origin
   Origin header and a custom request header. Both are cheap, and either one
   alone would do; a forged cross-origin POST cannot produce the header
   without a preflight, and no CORS headers are sent, so no preflight passes.
   ========================================================================= */
import { DbUnconfigured } from './db.js';

const APP_HEADER = 'x-tas-app';

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    if (extra) Object.assign(this, extra);
  }
}

export const bad = (code, message, extra) => new HttpError(400, code, message, extra);
export const unauthorized = (message) =>
  new HttpError(401, 'auth_required', message || 'Sign in to do that.');
export const forbidden = (message) => new HttpError(403, 'forbidden', message || 'Not allowed.');
export const notFound = (message) => new HttpError(404, 'not_found', message || 'Not found.');
export const tooMany = (message, retryAfter) =>
  new HttpError(429, 'rate_limited', message || 'Too many attempts. Wait a moment.', {
    retryAfter,
  });
/* The code is overridable because "that one thing is too big" and "there is
   no room for another one" are both 413, and a client wants to tell them
   apart without parsing the sentence. */
export const tooLarge = (message, code = 'too_large') =>
  new HttpError(413, code, message || 'That is too big.');
/* The whole database is near its ceiling (records.js databaseFull). 507
   Insufficient Storage: not this request's fault, and not fixed by
   retrying it smaller. */
export const storageFull = (message) =>
  new HttpError(
    507,
    'storage_full',
    message ||
      'This deployment has run out of room for new saved work. Nothing already saved is affected, ' +
        'and signing in still works. The site owner needs to clear space (npm run db:prune) ' +
        'or raise TAS_DB_BYTES on a bigger database.'
  );

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

export function redirect(res, location, status = 302) {
  res.statusCode = status;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

/* A page, not JSON: the OAuth callback is a browser navigation, so when it
   goes wrong the person is looking at the response rather than reading it in
   a console. Plain HTML, no styling to load, and a way back. */
export function errorPage(res, status, title, detail) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  res.end(
    '<!doctype html><meta charset="utf-8"><title>' +
      esc(title) +
      '</title><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#e5e8eb;' +
      'color:#081b23;font:16px/1.55 Georgia,serif;padding:24px}' +
      'main{max-width:34rem}h1{font:600 22px/1.2 system-ui,sans-serif;margin:0 0 10px}' +
      'p{margin:0 0 14px;color:#4a5c66}a{color:#2b4552}' +
      '@media(prefers-color-scheme:dark){body{background:#081b23;color:#e5e8eb}' +
      'p{color:#a8bac4}a{color:#b8d0d8}}</style>' +
      '<main><h1>' +
      esc(title) +
      '</h1><p>' +
      esc(detail) +
      '</p><p><a href="/">Back to the tree</a></p></main>'
  );
}

export function noContent(res) {
  res.statusCode = 204;
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

const MAX_BODY = 2_000_000; /* 2 MB — a tree definition is tens of KB */

export async function readJson(req) {
  /* Vercel's Node runtime parses a JSON body for us; the local dev server
     does not, and neither does a request that arrived as a stream. A body
     that arrives already parsed has skipped the count below, so the same
     ceiling is applied to it here — by the declared length when there is
     one, and by measuring it when there is not — or the only limit left on
     a pre-parsed body would be the platform's own 4.5 MB. */
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    const declared = Number(req.headers && req.headers['content-length']);
    const size = Number.isFinite(declared) && declared > 0 ? declared : jsonSize(req.body);
    if (size > MAX_BODY) throw tooLarge('The request body is larger than 2 MB.');
    return req.body;
  }
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > MAX_BODY) throw tooLarge('The request body is larger than 2 MB.');
    if (!req.body.length) return {};
    try {
      return JSON.parse(req.body.toString('utf8'));
    } catch {
      throw bad('bad_json', 'The request body was not valid JSON.');
    }
  }
  if (typeof req.body === 'string' && req.body) {
    if (Buffer.byteLength(req.body, 'utf8') > MAX_BODY) {
      throw tooLarge('The request body is larger than 2 MB.');
    }
    try {
      return JSON.parse(req.body);
    } catch {
      throw bad('bad_json', 'The request body was not valid JSON.');
    }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw tooLarge('The request body is larger than 2 MB.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw bad('bad_json', 'The request body was not valid JSON.');
  }
}

/* The body as bytes, for the one route that takes something other than JSON:
   an uploaded image. Capped while it streams, so an oversized upload is
   refused as it arrives rather than after it has all been held in memory.

   Two things this has to survive that readJson does not care about:

     - A runtime that has already buffered the body hands it over as
       req.body. Vercel's does that as a Buffer for some content types, so a
       Buffer is taken as it is. A string is not — it has been decoded as
       text somewhere on the way, and a JPEG decoded as UTF-8 is no longer the
       JPEG, so it is refused rather than stored damaged.
     - Going over the cap must not destroy the request. Leaving a for-await
       loop early destroys the stream, and destroying an IncomingMessage takes
       the socket with it, so the client would see a reset instead of the 413
       that says what went wrong. So this listens by hand, and on overflow
       stops keeping chunks and lets the rest drain to nowhere while the
       answer goes out. */
export async function readRaw(req, maxBytes) {
  const limit = Math.max(0, Math.floor(Number(maxBytes) || 0));
  const words =
    limit >= 1_000_000 && limit % 1_000_000 === 0
      ? limit / 1_000_000 + ' MB'
      : limit.toLocaleString('en-US') + ' bytes';
  const overflow = () => tooLarge('The request body is larger than ' + words + '.');

  if (Buffer.isBuffer(req.body) || req.body instanceof Uint8Array) {
    const buf = Buffer.from(req.body.buffer, req.body.byteOffset, req.body.byteLength);
    if (buf.length > limit) throw overflow();
    return buf;
  }
  if (typeof req.body === 'string' && req.body) {
    throw bad('bad_body', 'The upload arrived as text, not bytes, so it cannot be stored intact.');
  }
  /* A declared length over the cap is refused before a byte is read. The
     count below still applies, because the header is the client's word. */
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw overflow();
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        /* keep it flowing, so the rest is read and discarded */
        req.resume();
        finish(overflow());
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(null, Buffer.concat(chunks, size));
    const onError = (err) => finish(err);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    /* A stream that has already ended will never say 'end' again, so waiting
       for it would hang until the platform's timeout. But readableEnded is
       only the truth when req.on is the stream's own. Vercel reads every body
       before the handler runs and then replaces req.on on the request itself,
       replaying 'data' and 'end' from a copy; there the original stream is
       finished while the bytes are still on their way, and taking this
       shortcut stored every upload as empty. An own-property `on` means
       someone is replaying, so the listeners above are left to hear it. */
    if (req.readableEnded && !Object.prototype.hasOwnProperty.call(req, 'on')) {
      finish(null, Buffer.alloc(0));
    }
  });
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function isSecureRequest(req) {
  if (process.env.TAS_INSECURE_COOKIES === '1') return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (proto) return proto === 'https';
  return !!(req.socket && req.socket.encrypted);
}

export function setCookie(res, name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`];
  bits.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge != null) bits.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.expires) bits.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.httpOnly !== false) bits.push('HttpOnly');
  if (opts.secure) bits.push('Secure');
  bits.push(`SameSite=${opts.sameSite || 'Lax'}`);
  const prev = res.getHeader('Set-Cookie');
  const line = bits.join('; ');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, line) : [line]);
}

export function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || '';
}

/* Same-origin check for anything that changes state. An absent Origin is
   allowed — non-browser callers (curl, a script with a session token) send
   none, and the custom-header check below still applies to browsers. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === String(host);
  } catch {
    return false;
  }
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function guardWrite(req) {
  if (!WRITE_METHODS.has(req.method)) return;
  if (!sameOrigin(req)) throw forbidden('That request came from another origin.');
  if (!req.headers[APP_HEADER]) {
    throw forbidden(
      'Missing the ' + APP_HEADER + ' header. The page sends it; a cross-site form cannot.'
    );
  }
}

/* One entry point per route file. `handlers` maps a method to a function;
   errors become a JSON envelope the client can read rather than a stack
   trace in a 500. */
export function route(handlers) {
  return async function handler(req, res) {
    try {
      if (req.method === 'OPTIONS') {
        res.setHeader('Allow', Object.keys(handlers).concat('OPTIONS').join(', '));
        return noContent(res);
      }
      const fn = handlers[req.method];
      if (!fn) {
        res.setHeader('Allow', Object.keys(handlers).concat('OPTIONS').join(', '));
        throw new HttpError(405, 'method_not_allowed', `${req.method} is not allowed here.`);
      }
      guardWrite(req);
      await fn(req, res);
    } catch (err) {
      sendError(req, res, err);
    }
  };
}

function sendError(req, res, err) {
  if (res.headersSent) return;
  if (err instanceof HttpError) {
    const body = { error: err.code, message: err.message };
    if (err.retryAfter) {
      body.retryAfter = err.retryAfter;
      res.setHeader('Retry-After', String(Math.ceil(err.retryAfter)));
    }
    if (err.fields) body.fields = err.fields;
    /* Which proof of identity a reauth_required error will accept
       ('password' | 'google' | 'any'), set by auth.js requireRecentAuth, so
       the client offers only the ones that can work. */
    if (err.reauth) body.reauth = err.reauth;
    return json(res, err.status, body);
  }
  if (err instanceof DbUnconfigured || err?.code === 'db_unconfigured') {
    console.error('[api] DATABASE_URL is not set');
    return json(res, 503, {
      error: 'storage_unavailable',
      message:
        'Saving is not set up on this deployment yet — DATABASE_URL is not configured. ' +
        'The tool still works; nothing can be saved to an account.',
    });
  }
  /* A database that is there but unreachable reads the same way to a user as
     one that was never configured: saving is off, the tool still works. */
  if (
    err?.code === 'ECONNREFUSED' ||
    err?.code === 'ENOTFOUND' ||
    err?.code === 'ETIMEDOUT' ||
    err?.code === '57P03' ||
    err?.code === '53300'
  ) {
    console.error('[api] database unreachable:', err.code, err.message);
    return json(res, 503, {
      error: 'storage_unavailable',
      message: 'The database is not reachable right now. Your work has not been saved.',
    });
  }
  console.error('[api] unhandled error:', err && (err.stack || err.message || err));
  json(res, 500, { error: 'server_error', message: 'Something went wrong on the server.' });
}

/* ---- field helpers ----------------------------------------------------- */

export function str(v, { max = 400, trim = true } = {}) {
  if (v == null) return '';
  let s = String(v);
  if (trim) s = s.trim();
  /* control characters other than tab and newline have no business in a
     title or a name, and they make log lines lie */
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return s.length > max ? s.slice(0, max) : s;
}

export function jsonSize(v) {
  try {
    return Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');
  } catch {
    return Infinity;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return UUID_RE.test(s) ? s.toLowerCase() : null;
}

export function requireUuid(v, what = 'id') {
  const u = uuidOrNull(v);
  if (!u) throw bad('bad_id', `That ${what} is not a valid id.`);
  return u;
}

/* `req.query` on Vercel, and a parsed URL anywhere else. */
export function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    const u = new URL(req.url, 'http://localhost');
    return Object.fromEntries(u.searchParams.entries());
  } catch {
    return {};
  }
}

export function intOf(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function boolOf(v) {
  return v === true || v === '1' || v === 'true' || v === 'yes';
}
