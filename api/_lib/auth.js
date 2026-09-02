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
   section, is what limits the editor at /admin to one person.
   ========================================================================= */
import crypto from 'node:crypto';
import { query, one, tx, isUniqueViolation } from './db.js';
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

const COOKIE = 'tas_session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
/* Re-stamping the row on every request would be a write per read. A session
   is only touched when its last sighting is older than this. */
const TOUCH_AFTER_MS = 6 * 60 * 60 * 1000;

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

/* ---- throttling -------------------------------------------------------- */

const WINDOW_MIN = 15;
const MAX_FAILS_PER_IP = 30;
const MAX_FAILS_PER_ID = 8;

export async function throttle(buckets) {
  const now = Date.now();
  for (const b of buckets) {
    const r = await query(
      `select count(*)::int as n, max(at) as last
         from auth_attempts
        where bucket = $1 and ok = false and at > now() - ($2 || ' minutes')::interval`,
      [b.key, String(WINDOW_MIN)]
    );
    const n = r.rows[0]?.n || 0;
    if (n >= b.max) {
      const last = r.rows[0]?.last ? new Date(r.rows[0].last).getTime() : now;
      const retry = Math.max(30, Math.ceil((WINDOW_MIN * 60_000 - (now - last)) / 1000));
      throw tooMany(
        'Too many failed attempts. Try again in about ' +
          Math.ceil(retry / 60) +
          ' minute' +
          (retry > 90 ? 's' : '') +
          '.',
        retry
      );
    }
  }
}

export async function recordAttempt(buckets, ok) {
  /* One statement, and a cheap prune of anything older than the window so the
     table cannot grow without bound. Bookkeeping: if it fails, the request it
     was recording must still succeed or fail on its own merits. */
  const keys = buckets.map((b) => b.key);
  try {
    await query(
      `insert into auth_attempts (bucket, ok)
       select k, $2 from unnest($1::text[]) as k`,
      [keys, !!ok]
    );
    if (Math.random() < 0.05) {
      await query(`delete from auth_attempts where at < now() - interval '1 day'`);
    }
  } catch (err) {
    console.error('[auth] could not record an attempt:', err.message);
  }
}

export function attemptBuckets(req, email) {
  const ip = clientIp(req) || 'unknown';
  const id = normaliseEmail(email) || 'unknown';
  return [
    { key: 'ip:' + ip, max: MAX_FAILS_PER_IP },
    { key: 'id:' + id, max: MAX_FAILS_PER_ID },
  ];
}

/* ---- sessions ---------------------------------------------------------- */

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_MS);
  await query(
    `insert into sessions (id, user_id, token_hash, expires_at, user_agent, ip)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      crypto.randomUUID(),
      userId,
      hashToken(token),
      expires.toISOString(),
      str(req.headers['user-agent'] || '', { max: 300 }),
      clientIp(req).slice(0, 90),
    ]
  );
  setCookie(res, COOKIE, token, {
    maxAge: SESSION_MS / 1000,
    expires,
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'Lax',
  });
  /* A stale session cookie left over from a previous deployment on the same
     host would otherwise sit under this one. */
  return token;
}

export function clearSessionCookie(req, res) {
  setCookie(res, COOKIE, '', {
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
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = await one(
    `select s.id as sid, s.expires_at, s.last_seen_at,
            u.id, u.email, u.name, u.created_at
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
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
    const expires = new Date(Date.now() + SESSION_MS);
    await query(`update sessions set last_seen_at = now(), expires_at = $2 where id = $1`, [
      row.sid,
      expires.toISOString(),
    ]).catch(() => {});
    if (res) {
      setCookie(res, COOKIE, token, {
        maxAge: SESSION_MS / 1000,
        expires,
        httpOnly: true,
        secure: isSecureRequest(req),
        sameSite: 'Lax',
      });
    }
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
    sessionId: row.sid,
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

export async function endAllSessions(userId, exceptSessionId) {
  if (exceptSessionId) {
    await query('delete from sessions where user_id = $1 and id <> $2', [userId, exceptSessionId]);
  } else {
    await query('delete from sessions where user_id = $1', [userId]);
  }
}

/* ---- who may edit the tree ---------------------------------------------
   ADMIN_EMAIL names the one account allowed into /admin. Set it and the
   editor is that person's; leave it unset and the editor stays open to
   anyone who reaches the page, which is how this tool worked before accounts
   existed and how a local or storage-less deployment has to keep working.

   A comma-separated list is accepted for the case where the work changes
   hands and both people need it for a week — but one address is the intent.

   Be honest about what this is: /admin is a page of HTML and JavaScript that
   the browser fetches like any other. This check decides whether the editor
   is *presented*, and every saved tree is still scoped to its own account on
   the server. It is not a substitute for Vercel Deployment Protection, and
   the README says so where someone deciding will read it. */
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

/* ---- accounts ---------------------------------------------------------- */

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
  if (taken) {
    throw bad('email_taken', 'There is already an account with that email address.', {
      fields: { email: 'There is already an account with that email address.' },
    });
  }

  const hash = await hashPassword(password);
  const id = crypto.randomUUID();
  try {
    const row = await one(
      `insert into users (id, email, name, password_hash, last_login_at)
       values ($1, $2, $3, $4, now())
       returning id, email, name, created_at`,
      [id, normaliseEmail(email), cleanName, hash]
    );
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw bad('email_taken', 'There is already an account with that email address.', {
        fields: { email: 'There is already an account with that email address.' },
      });
    }
    throw err;
  }
}

async function findUserByEmail(email) {
  return one(
    `select id, email, name, password_hash, google_sub, created_at
       from users where lower(email) = lower($1)`,
    [normaliseEmail(email)]
  );
}

/* ---- sign in with Google ----------------------------------------------- */

/* Three cases, in order:

   1. We have seen this Google account before — sign that user in.
   2. We have not, but the verified address matches an account someone
      registered with a password. Link the two rather than refusing or
      creating a second account: it is the same person, and Google has
      verified the address, which is the whole reason linking on email is
      safe here and would not be on an unverified one.
   3. Neither — make an account. It has no password, and the account panel
      offers to set one so they are not locked to a single way in. */
export async function findOrCreateGoogleUser(profile) {
  const bySub = await one(
    `select id, email, name, created_at from users where google_sub = $1`,
    [profile.sub]
  );
  if (bySub) {
    await query(
      `update users set last_login_at = now(),
              name = case when coalesce(name,'') = '' then $2 else name end,
              avatar_url = coalesce(nullif($3,''), avatar_url),
              email = case when lower(email) <> lower($4) then $4 else email end,
              updated_at = now()
        where id = $1`,
      [bySub.id, str(profile.name, { max: 120 }), profile.picture, normaliseEmail(profile.email)]
    ).catch((err) => {
      /* The only way this fails is the new address already belonging to
         another account. Signing in still works; the address stays as it
         was, which is the safe half of the change. */
      console.error('[auth] could not refresh a Google profile:', err.message);
    });
    return { ...bySub, linked: false, created: false };
  }

  const byEmail = await findUserByEmail(profile.email);
  if (byEmail) {
    const row = await one(
      `update users set google_sub = $2, last_login_at = now(),
              name = case when coalesce(name,'') = '' then $3 else name end,
              avatar_url = coalesce(nullif($4,''), avatar_url),
              updated_at = now()
        where id = $1
        returning id, email, name, created_at`,
      [byEmail.id, profile.sub, str(profile.name, { max: 120 }), profile.picture]
    );
    return { ...row, linked: true, created: false };
  }

  const row = await one(
    `insert into users (id, email, name, password_hash, google_sub, avatar_url, last_login_at)
     values ($1, $2, $3, null, $4, $5, now())
     returning id, email, name, created_at`,
    [
      crypto.randomUUID(),
      normaliseEmail(profile.email),
      str(profile.name, { max: 120 }),
      profile.sub,
      profile.picture || null,
    ]
  );
  return { ...row, linked: false, created: true };
}

/* Attach a Google identity to the account that is already signed in. This is
   the other direction from findOrCreateGoogleUser: the session says who, and
   Google says which identity, so no email matching is involved and the two
   addresses are allowed to differ. */
export async function linkGoogle(userId, profile) {
  const owner = await one('select id from users where google_sub = $1', [profile.sub]);
  if (owner && owner.id !== userId) {
    const e = new Error('That Google account is already attached to another account here.');
    e.code = 'google_taken';
    throw e;
  }
  await query(
    `update users set google_sub = $2,
            avatar_url = coalesce(nullif($3,''), avatar_url),
            name = case when coalesce(name,'') = '' then $4 else name end,
            updated_at = now()
      where id = $1`,
    [userId, profile.sub, profile.picture || '', str(profile.name, { max: 120 })]
  );
}

/* Detach it again. Refused when it is the only way in, because an account
   nobody can sign in to is a deleted account with extra steps. */
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

/* The editor's gate, on the server side of it. Everything that changes what
   readers see goes through this, so the rule lives in one place rather than
   being re-derived per route. */
export async function requireEditor(req, res) {
  const user = await requireUser(req, res);
  if (adminGateOn() && !isAdminEmail(user.email)) {
    throw forbidden('The editor is limited to one account, and this is not it.');
  }
  return user;
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
  return { user: { id: user.id, email: user.email, name: user.name, createdAt: user.created_at } };
}

export async function changePassword(userId, currentPassword, nextPassword) {
  const row = await one('select id, email, name, password_hash from users where id = $1', [userId]);
  if (!row) throw unauthorized();
  /* An account that arrived through Google has no password yet. Setting the
     first one asks for no current password, because there is none to give —
     the session itself is the proof of who is asking. */
  if (row.password_hash) {
    const ok = await verifyPassword(currentPassword, row.password_hash);
    if (!ok) {
      throw bad('wrong_password', 'That is not your current password.', {
        fields: { current: 'That is not your current password.' },
      });
    }
  }
  const p = checkPassword(nextPassword, { email: row.email, name: row.name });
  if (p) throw bad('weak_password', p, { fields: { password: p } });
  const hash = await hashPassword(nextPassword);
  await query('update users set password_hash = $2, updated_at = now() where id = $1', [
    userId,
    hash,
  ]);
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
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt || null };
}
