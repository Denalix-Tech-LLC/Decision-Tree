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
export const tooLarge = (message) => new HttpError(413, 'too_large', message || 'That is too big.');

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
     does not, and neither does a request that arrived as a stream. */
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
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
