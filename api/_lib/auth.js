/* ===========================================================================
   ACCOUNTS AND SESSIONS
   Email and a password, hashed with scrypt from node:crypto — memory-hard, in
   the standard library, so there is no native build step and no dependency to
   keep patched. Sessions are opaque random tokens in an HttpOnly cookie; the
   database holds only their SHA-256, so a stolen dump cannot be replayed as a
   login.

   Google sign-in sits alongside, in google.js: an account is a place to keep
   work rather than a federated identity, so the two meet on a verified email
   address and neither is required. ADMIN_EMAIL, at the foot of the accounts
   section, is what limits the editor at /admin to one person — and only once
   that person's address has been PROVEN (users.email_verified), because an
   address typed into a registration form proves nothing.
   ========================================================================= */
import crypto from 'node:crypto';
import { query, one, tx, isUniqueViolation, isConfigured } from './db.js';
import {
  bad,
  unauthorized,
  forbidden,
  tooMany,
  parseCookies,
  setCookie,
  isSecureRequest,
  clientIp,
  str,
} from './http.js';

/* Over HTTPS the cookie is __Host- prefixed: the browser then refuses it
   unless it is Secure, host-only and Path=/, so a sibling subdomain (or a
   network attacker before HSTS) cannot plant a session of their choosing
   under this name. Plain HTTP — the local dev server — cannot use the prefix,
   so it keeps the bare name. A session cookie from before the prefix is not
   honoured over HTTPS: accepting it would keep the planting hole open, and
   the price is one sign-in. */
const COOKIE_SECURE = '__Host-tas_session';
const COOKIE_PLAIN = 'tas_session';
function cookieName(req) {
  return isSecureRequest(req) ? COOKIE_SECURE : COOKIE_PLAIN;
}

/* Two clocks on a session. It dies after IDLE unused, and after ABSOLUTE
   whatever happens: sliding expiry alone meant a session used once a week
   lived for ever, which is what a stolen cookie wants. */
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 14 * DAY_MS;
const SESSION_ABSOLUTE_DAYS = 30;
const SESSION_ABSOLUTE_MS = SESSION_ABSOLUTE_DAYS * DAY_MS;
/* Re-stamping the row on every request would be a write per read. A session
   is only touched when its last sighting is older than this. */
const TOUCH_AFTER_MS = 6 * 60 * 60 * 1000;
/* Enough for every browser and device a person really uses, and a ceiling on
   how many rows one account can make by signing in in a loop. */
const MAX_SESSIONS_PER_USER = 20;
/* How recent a sign-in has to be to stand in for the password on a sensitive
   change. Long enough to open Account settings and make the change; short
   enough that a browser left signed in on a shared machine has lost it. */
export const RECENT_AUTH_MS = 10 * 60 * 1000;

/* ---- password hashing -------------------------------------------------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scrypt(password, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      params.keylen,
      { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT);
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const params = {
    N: parseInt(parts[1], 10),
    r: parseInt(parts[2], 10),
    p: parseInt(parts[3], 10),
    keylen: 0,
  };
  if (!params.N || !params.r || !params.p) return false;
  let salt, expected;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  params.keylen = expected.length;
  if (!params.keylen) return false;
  const got = await scrypt(password, salt, params);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

/* ---- credential rules -------------------------------------------------- */

/* Deliberately permissive on shape and strict on length: a composition rule
   ("one capital, one digit") buys less than four more characters, and this
   audience includes people typing on a phone in a meeting. */
export const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;

const WEAK = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  '12345678901',
  'qwertyuiop',
  'letmein123',
  'iloveyou123',
  'administrator',
  'decisiontree',
]);

export function checkPassword(password, { email = '', name = '' } = {}) {
  const pw = String(password || '');
  if (pw.length < PASSWORD_MIN) {
    return `Use at least ${PASSWORD_MIN} characters. A short phrase you will remember beats a scramble you will not.`;
  }
  if (pw.length > PASSWORD_MAX) return `Keep it under ${PASSWORD_MAX} characters.`;
  const flat = pw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (WEAK.has(flat)) return 'That password is one of the first anyone guesses. Pick another.';
  if (/^(.)\1+$/.test(pw)) return 'That is one character repeated. Pick another.';
  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length > 3 && flat.includes(local.replace(/[^a-z0-9]/g, ''))) {
    return 'Do not use your email address as your password.';
  }
  const nm = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (nm.length > 4 && flat === nm) return 'Do not use your own name as your password.';
  return null;
}

/* Not RFC 5322 — that grammar accepts strings no mail server would. This
   accepts what people actually type and rejects what is plainly not an
   address, and the address is never used to send anything from the server. */
const EMAIL_RE = /^[^\s@,;:<>"'()[\]\\]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export function normaliseEmail(v) {
  return String(v || '').trim().toLowerCase();
}

export function checkEmail(email) {
  const e = normaliseEmail(email);
  if (!e) return 'Enter your email address.';
  if (e.length > 254) return 'That email address is too long.';
  if (!EMAIL_RE.test(e)) return 'That does not look like an email address.';
  return null;
}

/* ---- throttling --------------------------------------------------------
   Every guess at a password is RESERVED before it is checked: one short
   transaction takes a lock per bucket, counts what is already there, refuses
   if that is over the limit, and otherwise writes a pending failure row. The
   check then runs, and settleAttempt() turns the row into a success if it
   was one. The old way — count, run scrypt, then record — let any number of
   parallel requests all pass the count before any of them recorded, which
   made the limit decorative.

   Buckets, for signing in and for every other place a password is checked:

     ip:<ip>                 failures from one address, whatever the account
     acct-ip:<email>|<ip>    failures against one account from one address
     acct:<email>            failures against one account from anywhere — a
                             ceiling on a distributed guess. It is waived for
                             an address this account has already signed in
                             from, so a flood elsewhere slows strangers down
                             but cannot shut the owner out of their account.
     uid:<id>                current-password checks from inside a session

   and for registering, reg:<ip>, which counts SUCCESSES: 20 accounts an hour
   per address by default (TAS_REGISTRATIONS_PER_IP), enough for a room of
   people behind one office address, so one client still cannot mint
   accounts to fill the database. Past it the reply is a 429, "Too many
   attempts. Try again in about N minutes."

   An IPv6 client usually holds a whole /64, so IPv6 buckets are keyed on the
   /64 rather than the address; otherwise every guess could come from a new
   one. */
const FAIL_WINDOW_MIN = 15;
const MAX_FAILS_PER_IP = 30;
const MAX_FAILS_PER_ACCOUNT_IP = 8;
const MAX_FAILS_PER_ACCOUNT = 30;
const MAX_FAILS_PER_SESSION_USER = 10;
/* Successful registrations per client address per hour. Not 5: a Tribal
   office, a conference room or a training session usually reaches the
   internet through ONE address, and a group onboarding together must not be
   refused at the sixth person. The storage concern it guards against is
   also bounded by the per-account byte budget in records.js, so this only
   has to stop one client minting accounts by the thousand. A deployment
   that runs larger sessions sets TAS_REGISTRATIONS_PER_IP (a whole number,
   1 to 1000); anything else falls back to the default. Read per request, so
   changing it needs a redeploy but no code change. */
const REGISTER_WINDOW_MIN = 60;
const DEFAULT_REGISTRATIONS_PER_IP = 20;
export function registrationsPerIp() {
  const raw = String(process.env.TAS_REGISTRATIONS_PER_IP || '').trim();
  if (!/^\d{1,4}$/.test(raw)) return DEFAULT_REGISTRATIONS_PER_IP;
  const n = parseInt(raw, 10);
  return n >= 1 && n <= 1000 ? n : DEFAULT_REGISTRATIONS_PER_IP;
}
/* A lock class of our own, so these advisory locks cannot collide with the
   schema lock in db.js (a single bigint key). */
const THROTTLE_LOCK_CLASS = 7271;

export function ipKey(ip) {
  let s = String(ip || '').trim().toLowerCase();
  if (!s) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return mapped[1];
  if (s.indexOf(':') < 0) return s.slice(0, 64);
  s = s.split('%')[0];
  const halves = s.split('::');
  if (halves.length > 2) return s.slice(0, 64);
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? Math.max(0, 8 - head.length - tail.length) : 0;
  const groups = head.concat(new Array(fill).fill('0'), tail);
  return (
    groups
      .slice(0, 4)
      .map((g) => (parseInt(g, 16) || 0).toString(16))
      .join(':') + '::/64'
  );
}

/* Has this account signed in from this address before? A session made from
   it that is still on file (live, or expired and not yet pruned), or a
   success recorded against it in the last day. */
async function signedInFromHereBefore(client, email, rawIp, acctIpKey) {
  const r = await client.query(
    `select exists (
              select 1 from sessions s join users u on u.id = s.user_id
               where lower(u.email) = lower($1) and s.ip = $2
            )
         or exists (
              select 1 from auth_attempts
               where bucket = $3 and ok = true and at > now() - interval '1 day'
            ) as known`,
    [email, rawIp, acctIpKey]
  );
  return !!(r.rows[0] && r.rows[0].known);
}

function retryMessage(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return (
    'Too many attempts. Try again in about ' + minutes + ' minute' + (minutes === 1 ? '' : 's') + '.'
  );
}

/* Returns a ticket for settleAttempt(), or throws 429. Each bucket is
   { key, max, windowMin, counts: 'failures' | 'all', waive?(client) }. */
export async function reserveAttempt(buckets) {
  const list = buckets
    .filter(Boolean)
    .slice()
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const rows = await tx(async (client) => {
    /* Sorted, so two requests over overlapping buckets take the locks in the
       same order and cannot deadlock each other. Transaction-scoped, so a
       pooler gives them back with the transaction. */
    for (const b of list) {
      await client.query('select pg_advisory_xact_lock($1, hashtext($2))', [
        THROTTLE_LOCK_CLASS,
        b.key,
      ]);
    }
    for (const b of list) {
      const onlyFailures = b.counts !== 'all';
      const cond = onlyFailures ? 'and ok = false' : '';
      const r = await client.query(
        `select count(*)::int as n from auth_attempts
          where bucket = $1 ${cond} and at > now() - ($2 || ' minutes')::interval`,
        [b.key, String(b.windowMin)]
      );
      const n = (r.rows[0] && r.rows[0].n) || 0;
      if (n < b.max) continue;
      if (b.waive && (await b.waive(client))) continue;
      /* When the oldest attempt that still counts against the limit ages
         out of the window, there is room for one more. */
      const w = await client.query(
        `select greatest(1, ceil(extract(epoch from
                  (at + ($2 || ' minutes')::interval - now()))))::int as wait
           from auth_attempts
          where bucket = $1 ${cond} and at > now() - ($2 || ' minutes')::interval
          order by at desc offset $3 limit 1`,
        [b.key, String(b.windowMin), b.max - 1]
      );
      const wait = Math.max(30, (w.rows[0] && w.rows[0].wait) || b.windowMin * 60);
      throw tooMany(retryMessage(wait), wait);
    }
    const ins = await client.query(
      `insert into auth_attempts (bucket, ok)
       select k, false from unnest($1::text[]) as k
       returning id, bucket`,
      [list.map((b) => b.key)]
    );
    return ins.rows;
  });
  const countsAll = new Set(list.filter((b) => b.counts === 'all').map((b) => b.key));
  return {
    ids: rows.map((r) => r.id),
    successOnly: rows.filter((r) => countsAll.has(r.bucket)).map((r) => r.id),
  };
}

/* Bookkeeping: if it fails, the request it was recording must still succeed
   or fail on its own merits, so errors are logged and swallowed. A failure
   leaves its pending rows as failures; in a bucket that counts only
   successes, the row is removed instead. */
export async function settleAttempt(ticket, ok) {
  if (!ticket) return;
  try {
    if (ok) {
      if (ticket.ids.length) {
        await query('update auth_attempts set ok = true where id = any($1::bigint[])', [ticket.ids]);
      }
    } else if (ticket.successOnly.length) {
      await query('delete from auth_attempts where id = any($1::bigint[])', [ticket.successOnly]);
    }
    /* a cheap prune, so the table cannot grow without bound */
    if (Math.random() < 0.05) {
      await query(`delete from auth_attempts where at < now() - interval '1 day'`);
    }
  } catch (err) {
    console.error('[auth] could not settle an attempt:', err.message);
  }
}

/* Signing in, and anywhere else a password for a named account is checked. */
export function signInBuckets(req, email) {
  const raw = clientIp(req).slice(0, 90);
  const ip = ipKey(raw);
  const id = normaliseEmail(email).slice(0, 254) || 'unknown';
  const acctIp = 'acct-ip:' + id + '|' + ip;
  return [
    { key: 'ip:' + ip, max: MAX_FAILS_PER_IP, windowMin: FAIL_WINDOW_MIN },
    { key: acctIp, max: MAX_FAILS_PER_ACCOUNT_IP, windowMin: FAIL_WINDOW_MIN },
    {
      key: 'acct:' + id,
      max: MAX_FAILS_PER_ACCOUNT,
      windowMin: FAIL_WINDOW_MIN,
      waive: (client) => signedInFromHereBefore(client, id, raw, acctIp),
    },
  ];
}

/* Registering. Failures (a bad field, an address already taken) count
   against the address like a failed sign-in, which also slows anyone using
   "that address is taken" to find out who has an account. They do not count
   against the account named, so nobody can lock someone out by failing to
   register their address. Successes are what reg:<ip> limits. */
export function registerBuckets(req) {
  const ip = ipKey(clientIp(req));
  return [
    { key: 'ip:' + ip, max: MAX_FAILS_PER_IP, windowMin: FAIL_WINDOW_MIN },
    {
      key: 'reg:' + ip,
      max: registrationsPerIp(),
      windowMin: REGISTER_WINDOW_MIN,
      counts: 'all',
    },
  ];
}

/* A current-password check from inside a session: the sign-in buckets for
   that account and address, plus one on the account id, so a borrowed
   session cannot be used to guess the password at leisure either. */
function sessionPasswordBuckets(req, user) {
  return signInBuckets(req, user.email).concat({
    key: 'uid:' + user.id,
    max: MAX_FAILS_PER_SESSION_USER,
    windowMin: FAIL_WINDOW_MIN,
  });
}

/* ---- sessions ---------------------------------------------------------- */

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function sessionCookie(req, res, token, expires) {
  setCookie(res, cookieName(req), token, {
    maxAge: Math.max(0, (expires.getTime() - Date.now()) / 1000),
    expires,
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'Lax',
  });
}

/* `authedAt` is when this session last proved who it is. A sign-in passes
   nothing and gets "now"; a session that replaces another (a password
   change) carries over what the old one had unless the request proved it
   again. */
export async function createSession(req, res, userId, { authedAt } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  /* idle expiry, which is always inside the absolute one at creation */
  const expires = new Date(Date.now() + Math.min(SESSION_IDLE_MS, SESSION_ABSOLUTE_MS));
  const authed = authedAt === undefined ? new Date() : authedAt ? new Date(authedAt) : null;
  const id = crypto.randomUUID();
  await query(
    `insert into sessions (id, user_id, token_hash, expires_at, user_agent, ip, authed_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      userId,
      hashToken(token),
      expires.toISOString(),
      str(req.headers['user-agent'] || '', { max: 300 }),
      clientIp(req).slice(0, 90),
      authed ? authed.toISOString() : null,
    ]
  );
  /* Keep the newest few per account. Without this every sign-in added a row
     for good, and a script signing in in a loop grew the table without
     limit. Pruning here, rather than in a cron nobody set up, is what makes
     the cap real. */
  await query(
    `delete from sessions
      where user_id = $1
        and id in (select id from sessions where user_id = $1
                    order by created_at desc, id desc offset $2)`,
    [userId, MAX_SESSIONS_PER_USER]
  ).catch((err) => console.error('[auth] could not prune sessions:', err.message));
  if (Math.random() < 0.02) {
    await query(
      `delete from sessions where expires_at < now()
          or created_at < now() - interval '${SESSION_ABSOLUTE_DAYS} days'`
    ).catch(() => {});
  }
  sessionCookie(req, res, token, expires);
  return token;
}

export function clearSessionCookie(req, res) {
  setCookie(res, cookieName(req), '', {
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'Lax',
  });
}

/* The signed-in user, or null. Never throws for "not signed in" — that is a
   normal state here, because a guest is a first-class visitor. */
export async function currentUser(req, res) {
  const cookies = parseCookies(req);
  const secure = isSecureRequest(req);
  /* A pre-prefix cookie left in an HTTPS browser is taken off it, so it stops
     riding along on every request. It is never read. */
  if (secure && cookies[COOKIE_PLAIN] && res) {
    setCookie(res, COOKIE_PLAIN, '', { maxAge: 0, expires: new Date(0), secure: true, sameSite: 'Lax' });
  }
  const token = cookies[cookieName(req)];
  if (!token) return null;
  const row = await one(
    `select s.id as sid, s.created_at as s_created, s.expires_at, s.last_seen_at, s.authed_at,
            u.id, u.email, u.name, u.created_at, u.email_verified
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()
        and s.created_at > now() - interval '${SESSION_ABSOLUTE_DAYS} days'`,
    [hashToken(token)]
  );
  if (!row) {
    /* Expired or revoked: take the cookie off the browser so every later
       request stops carrying a token that will never work again. */
    if (res) clearSessionCookie(req, res);
    return null;
  }
  const seen = new Date(row.last_seen_at).getTime();
  if (Date.now() - seen > TOUCH_AFTER_MS) {
    /* Sliding, but never past the absolute lifetime. */
    const expires = new Date(
      Math.min(Date.now() + SESSION_IDLE_MS, new Date(row.s_created).getTime() + SESSION_ABSOLUTE_MS)
    );
    await query(`update sessions set last_seen_at = now(), expires_at = $2 where id = $1`, [
      row.sid,
      expires.toISOString(),
    ]).catch(() => {});
    if (res) sessionCookie(req, res, token, expires);
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
    emailVerified: row.email_verified === true,
    sessionId: row.sid,
    authedAt: row.authed_at || null,
  };
}

export async function requireUser(req, res) {
  const user = await currentUser(req, res);
  if (!user) throw unauthorized('Sign in to save or open your work.');
  return user;
}

export async function endSession(sessionId) {
  await query('delete from sessions where id = $1', [sessionId]);
}

/* Whatever session the browser is presenting ends, whoever it belongs to.
   Called by every route that is about to give this browser a NEW session
   (signing in, the account panel's "confirm it is you", Google, registering):
   the new cookie replaces the old one, so no legitimate holder of the old
   token remains — and if that token had leaked, re-authenticating must not
   leave it working for the rest of its 30 days. Keyed on the token itself,
   so it needs no join and works on a row that has already expired. A failure
   is logged and does not stop the sign-in: the old behaviour was to keep the
   row, and refusing the person over bookkeeping would be worse. */
export async function endPresentedSession(req) {
  const token = parseCookies(req)[cookieName(req)];
  if (!token) return;
  try {
    await query('delete from sessions where token_hash = $1', [hashToken(token)]);
  } catch (err) {
    console.error('[auth] could not end the previous session:', err.message);
  }
}

export async function endAllSessions(userId, exceptSessionId) {
  if (exceptSessionId) {
    await query('delete from sessions where user_id = $1 and id <> $2', [userId, exceptSessionId]);
  } else {
    await query('delete from sessions where user_id = $1', [userId]);
  }
}

/* Every session on the account goes, this one included, and this browser
   gets a brand-new token. For a password change: the old token may be the
   very thing that leaked, so keeping it would leave the change half done. */
export async function replaceSessions(req, res, user, { authedAt } = {}) {
  await endAllSessions(user.id);
  await createSession(req, res, user.id, {
    authedAt: authedAt === undefined ? user.authedAt : authedAt,
  });
}

/* ---- proving it is still you -------------------------------------------
   Setting or changing a password, attaching or detaching Google, closing the
   account and signing other browsers out all need more than a session: the
   current password in the request, or a sign-in within RECENT_AUTH_MS. A
   browser left signed in on a Council laptop must not be enough to add a
   way in for someone else, or to take the owner's away. */
export function recentAuthUntil(user) {
  const t = user && user.authedAt ? new Date(user.authedAt).getTime() : 0;
  return t ? new Date(t + RECENT_AUTH_MS).toISOString() : null;
}

export function isRecentlyAuthed(user) {
  const until = recentAuthUntil(user);
  return !!until && new Date(until).getTime() > Date.now();
}

function reauthRequired(row, field) {
  const hasPassword = !!row.password_hash;
  const hasGoogle = !!row.google_sub;
  const msg = hasPassword
    ? 'Enter your current password to make this change — or sign in again, and make it within ten minutes.'
    : 'Sign in again with Google first, then make this change within ten minutes.';
  const e = forbidden(msg);
  e.code = 'reauth_required';
  /* Which proof would do. http.js does not forward this yet; the client
     offers every way in the account has when it is absent. */
  e.reauth = hasPassword && hasGoogle ? 'any' : hasPassword ? 'password' : 'google';
  if (hasPassword) e.fields = { [field]: 'Enter your current password.' };
  return e;
}

/* Resolves with 'password' when the request carried the right password (and
   marks the session as freshly proven), 'recent' when the session proved
   itself recently enough, or throws. A password that is supplied is always
   checked, and a wrong one is refused even on a recent session: the person
   said it was theirs. Every check goes through the throttle. */
export async function requireRecentAuth(req, user, { password, field = 'password' } = {}) {
  const row = await one('select password_hash, google_sub from users where id = $1', [user.id]);
  if (!row) throw unauthorized();
  const pw = typeof password === 'string' ? password : '';
  if (pw && row.password_hash) {
    const ticket = await reserveAttempt(sessionPasswordBuckets(req, user));
    const ok = await verifyPassword(pw, row.password_hash);
    await settleAttempt(ticket, ok);
    if (!ok) {
      const msg = field === 'current' ? 'That is not your current password.' : 'That is not your password.';
      throw bad('wrong_password', msg, { fields: { [field]: msg } });
    }
    await query('update sessions set authed_at = now() where id = $1', [user.sessionId]).catch(
      () => {}
    );
    return 'password';
  }
  if (isRecentlyAuthed(user)) return 'recent';
  throw reauthRequired(row, field);
}

/* ---- who may edit the tree ---------------------------------------------
   ADMIN_EMAIL names the one account allowed into /admin, and that account
   must also have a PROVEN address (users.email_verified): proven by signing
   in with Google as that address, or vouched for by scripts/admin-user.mjs.
   Without the second half, whoever registered the address first — with any
   password, no questions asked — was the editor of what every reader sees.

   With a database and no ADMIN_EMAIL, NOBODY may publish, withdraw or
   upload. Accounts exist then and anyone can register one, so "no gate"
   would mean "everyone's"; failing closed makes a forgotten variable an
   error message rather than a defaced tree. With no database there are no
   accounts and nothing to publish to, and the editor works on local drafts
   exactly as before.

   A comma-separated list is accepted for the case where the work changes
   hands and both people need it for a week — but one address is the intent.

   Be honest about what this is: /admin is a page of HTML and JavaScript that
   the browser fetches like any other. This check decides who may change
   what readers see; it is not a substitute for Vercel Deployment
   Protection, and the README says so where someone deciding will read it. */
function adminEmails() {
  return String(process.env.ADMIN_EMAIL || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
export function adminGateOn() {
  return adminEmails().length > 0;
}
export function isAdminEmail(email) {
  const list = adminEmails();
  if (!list.length) return false;
  return list.includes(normaliseEmail(email));
}
/* The whole rule, in one place: named in ADMIN_EMAIL and proven. */
export function isAdmin(user) {
  return !!user && user.emailVerified === true && isAdminEmail(user.email);
}
/* Why a signed-in (or not) visitor is not the editor, in a code the pages can
   branch on; null when there is nothing to explain. */
export function adminReason(user) {
  if (!adminGateOn()) return 'admin_unset';
  if (user && isAdminEmail(user.email) && user.emailVerified !== true) return 'admin_unverified';
  return null;
}

function editorRefusal(code, message) {
  const e = forbidden(message);
  e.code = code;
  return e;
}

/* The editor's gate, on the server side of it. Everything that changes what
   readers see goes through this, so the rule lives in one place rather than
   being re-derived per route. A guest is told to sign in first (401). */
export async function requireEditor(req, res) {
  const user = await requireUser(req, res);
  if (isConfigured() && !adminGateOn()) {
    throw editorRefusal(
      'admin_unset',
      'No editor is configured: ADMIN_EMAIL must be set on this deployment before anyone can ' +
        'publish, withdraw or upload. Set it to the editor’s address and redeploy.'
    );
  }
  if (!isAdminEmail(user.email)) {
    throw forbidden('The editor is limited to one account, and this is not it.');
  }
  if (user.emailVerified !== true) {
    throw editorRefusal(
      'admin_unverified',
      'This is the editor’s address, but it has not been verified yet. Sign in with Google as ' +
        'this address, or have the site owner run "node scripts/admin-user.mjs verify ' +
        user.email +
        '".'
    );
  }
  return user;
}

/* ---- accounts ---------------------------------------------------------- */

const EMAIL_TAKEN = 'There is already an account with that email address.';

/* Registration. The address is stored exactly as typed and never marked
   verified here — nothing about this request proves it. */
export async function createUser({ email, name, password }) {
  const e = checkEmail(email);
  if (e) throw bad('bad_email', e, { fields: { email: e } });
  const cleanName = str(name, { max: 120 });
  const p = checkPassword(password, { email, name: cleanName });
  if (p) throw bad('weak_password', p, { fields: { password: p } });

  /* Asked before inserting, so the ordinary case — someone who forgot they
     already have an account — is answered by a select rather than by a
     constraint violation. The catch below still stands, for the race where
     two registrations for one address arrive together. */
  const taken = await findUserByEmail(email);
  if (taken) throw bad('email_taken', EMAIL_TAKEN, { fields: { email: EMAIL_TAKEN } });

  const hash = await hashPassword(password);
  const id = crypto.randomUUID();
  try {
    const row = await one(
      `insert into users (id, email, name, password_hash, email_verified, last_login_at)
       values ($1, $2, $3, $4, false, now())
       returning id, email, name, created_at, email_verified`,
      [id, normaliseEmail(email), cleanName, hash]
    );
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw bad('email_taken', EMAIL_TAKEN, { fields: { email: EMAIL_TAKEN } });
    }
    throw err;
  }
}

async function findUserByEmail(email) {
  return one(
    `select id, email, name, password_hash, google_sub, email_verified, created_at
       from users where lower(email) = lower($1)`,
    [normaliseEmail(email)]
  );
}

/* ---- sign in with Google ----------------------------------------------- */

function googleError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/* `profile` comes from readIdToken in google.js, which refuses any token
   whose email_verified claim is not exactly true — so profile.email is an
   address Google has proven belongs to whoever just signed in. Four cases:

   1. We have seen this Google identity before — sign that user in. The
      account's address is NEVER rewritten to the Google one: doing so used to
      remove the editor's access the day they signed in with a personal
      Google account, and free the ADMIN_EMAIL address for someone else to
      register.
   2. The address matches an account whose address is already verified —
      the same proven person. Attach this identity and sign them in.
   3. The address matches an account whose address was never verified: it
      was registered with a password by someone who never proved they own
      the address. Google has just proved who does. The owner takes it over:
      the password someone else chose is removed and every session on the
      account is ended, so a squatter who pre-registered the address keeps
      neither. The owner can set their own password from Account settings.
   4. Neither — make an account, verified, with no password. */
export async function findOrCreateGoogleUser(profile) {
  const email = normaliseEmail(profile.email);
  const name = str(profile.name, { max: 120 });
  const picture = profile.picture || '';

  const bySub = await one(
    `select id, email, name, created_at, email_verified from users where google_sub = $1`,
    [profile.sub]
  );
  if (bySub) {
    await query(
      `update users set last_login_at = now(),
              name = case when coalesce(name,'') = '' then $2 else name end,
              avatar_url = coalesce(nullif($3,''), avatar_url),
              email_verified = email_verified or lower(email) = lower($4),
              updated_at = now()
        where id = $1`,
      [bySub.id, name, picture, email]
    );
    return { ...bySub, linked: false, created: false, reclaimed: false };
  }

  const byEmail = await findUserByEmail(email);
  if (byEmail && byEmail.email_verified) {
    if (byEmail.google_sub && byEmail.google_sub !== profile.sub) {
      /* The owner has already attached a different Google account. Swapping
         it silently would remove a way in they chose; they can detach it in
         Account settings first if this is the one they want. */
      throw googleError(
        'google_conflict',
        'The account on this address already has a different Google account attached.'
      );
    }
    const row = await one(
      `update users set google_sub = $2, last_login_at = now(),
              name = case when coalesce(name,'') = '' then $3 else name end,
              avatar_url = coalesce(nullif($4,''), avatar_url),
              updated_at = now()
        where id = $1
        returning id, email, name, created_at, email_verified`,
      [byEmail.id, profile.sub, name, picture]
    );
    return { ...row, linked: true, created: false, reclaimed: false };
  }
  if (byEmail) {
    const row = await tx(async (client) => {
      const r = await client.query(
        `update users set google_sub = $2, password_hash = null, email_verified = true,
                last_login_at = now(),
                name = case when coalesce(name,'') = '' then $3 else name end,
                avatar_url = coalesce(nullif($4,''), avatar_url),
                updated_at = now()
          where id = $1
          returning id, email, name, created_at, email_verified`,
        [byEmail.id, profile.sub, name, picture]
      );
      await client.query('delete from sessions where user_id = $1', [byEmail.id]);
      return r.rows[0];
    });
    return { ...row, linked: true, created: false, reclaimed: true };
  }

  const row = await one(
    `insert into users (id, email, name, password_hash, google_sub, avatar_url, email_verified, last_login_at)
     values ($1, $2, $3, null, $4, $5, true, now())
     returning id, email, name, created_at, email_verified`,
    [crypto.randomUUID(), email, name, profile.sub, picture || null]
  );
  return { ...row, linked: false, created: true, reclaimed: false };
}

/* Attach a Google identity to the account that is already signed in. This is
   the other direction from findOrCreateGoogleUser: the session says who, and
   Google says which identity, so the two addresses are allowed to differ.
   When they are the same, Google has just proven the account's address, so
   it becomes verified. The caller has already required a recent sign-in and
   ends the account's other sessions. */
export async function linkGoogle(userId, profile) {
  const owner = await one('select id from users where google_sub = $1', [profile.sub]);
  if (owner && owner.id !== userId) {
    throw googleError('google_taken', 'That Google account is already attached to another account here.');
  }
  const me = await one('select google_sub from users where id = $1', [userId]);
  if (!me) throw unauthorized();
  if (me.google_sub && me.google_sub !== profile.sub) {
    throw googleError(
      'google_conflict',
      'A different Google account is already attached to this one. Remove it first.'
    );
  }
  await query(
    `update users set google_sub = $2,
            avatar_url = coalesce(nullif($3,''), avatar_url),
            name = case when coalesce(name,'') = '' then $4 else name end,
            email_verified = email_verified or lower(email) = lower($5),
            updated_at = now()
      where id = $1`,
    [userId, profile.sub, profile.picture || '', str(profile.name, { max: 120 }), normaliseEmail(profile.email)]
  );
}

/* Detach it again. Refused when it is the only way in, because an account
   nobody can sign in to is a deleted account with extra steps. The caller has
   already required a recent sign-in and ends the account's other sessions. */
export async function unlinkGoogle(userId) {
  const row = await one('select password_hash, google_sub from users where id = $1', [userId]);
  if (!row) throw unauthorized();
  if (!row.google_sub) throw bad('not_linked', 'No Google account is attached to this one.');
  if (!row.password_hash) {
    throw bad(
      'last_method',
      'Set a password first — otherwise removing Google would leave no way to sign in.'
    );
  }
  await query('update users set google_sub = null, updated_at = now() where id = $1', [userId]);
}

/* What the account panel needs to show: which ways in this account has. */
export async function signInMethods(userId) {
  const row = await one(
    `select (password_hash is not null) as password, (google_sub is not null) as google
       from users where id = $1`,
    [userId]
  );
  return { password: !!(row && row.password), google: !!(row && row.google) };
}

/* Constant-ish work whether or not the account exists, so response time does
   not tell an attacker which addresses are registered. */
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

/* Returns the user, or a reason. `google_only` is told to the person rather
   than hidden behind the generic message: an account made through Google has
   no password, and someone typing one into the wrong box would otherwise be
   stuck for good. Registration already discloses that an address is taken, so
   this reveals nothing that endpoint does not. */
export async function authenticate(email, password) {
  const user = await findUserByEmail(email);
  const ok = await verifyPassword(password, user && user.password_hash ? user.password_hash : DUMMY_HASH);
  if (user && !user.password_hash) return { reason: user.google_sub ? 'google_only' : 'no_password' };
  if (!user || !ok) return { reason: 'bad_credentials' };
  await query('update users set last_login_at = now() where id = $1', [user.id]).catch(() => {});
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.created_at,
      emailVerified: user.email_verified === true,
    },
  };
}

/* Store a new password, after the strength rules. Proving the person may do
   this is the caller's job (requireRecentAuth in the route; database access
   for scripts/admin-user.mjs). */
export async function setPassword(userId, nextPassword) {
  const row = await one('select id, email, name from users where id = $1', [userId]);
  if (!row) throw unauthorized();
  const p = checkPassword(nextPassword, { email: row.email, name: row.name });
  if (p) throw bad('weak_password', p, { fields: { password: p } });
  const hash = await hashPassword(nextPassword);
  await query('update users set password_hash = $2, updated_at = now() where id = $1', [userId, hash]);
}

/* The library-level change: the current password must match when the
   account has one. An account that arrived through Google has none, so its
   first password needs no current one here — the HTTP route in front of
   this still demands a recent sign-in for that, so a borrowed session is not
   enough. */
export async function changePassword(userId, currentPassword, nextPassword) {
  const row = await one('select password_hash from users where id = $1', [userId]);
  if (!row) throw unauthorized();
  if (row.password_hash && !(await verifyPassword(String(currentPassword || ''), row.password_hash))) {
    throw bad('wrong_password', 'That is not your current password.', {
      fields: { current: 'That is not your current password.' },
    });
  }
  await setPassword(userId, nextPassword);
}

export async function deleteAccount(userId) {
  /* One transaction, and the cascades take the sessions and the work with
     the row. Nothing is kept back. */
  await tx(async (client) => {
    await client.query('delete from users where id = $1', [userId]);
  });
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt || null,
    emailVerified: user.emailVerified === true,
  };
}
