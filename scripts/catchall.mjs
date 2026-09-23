/* ===========================================================================
   THE PRODUCTION DISPATCH, EXERCISED
   Every endpoint on Vercel is served by one function, api/[...route].js, which
   dispatches from a hand-written table. scripts/selftest.mjs drives the dev
   server instead — a directory walk — so on its own it would pass with the
   catch-all completely broken.

   This serves the API the way Vercel will: every request through the catch-all,
   with req.query populated as the Vercel Node runtime populates it (parsed
   search params, plus the matched segments under the catch-all's name) and a
   parsed JSON body. A difference here is a difference there.

   Only a JSON body is parsed ahead of the route, because that is all the
   Vercel runtime parses: for an image/* upload its req.body is undefined and
   the bytes arrive through 'data'/'end' listeners replayed from a copy, the
   original stream having already been read (see replayLikeVercel below).
   This harness used to read every
   body and decode it as UTF-8, which would have passed JSON routes and
   quietly mangled every uploaded photograph.
   ========================================================================= */
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.mjs';

/* run from the repo root whichever directory this was invoked from, so
   loadEnv() finds .env and PGlite writes where it is expected */
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
loadEnv();
process.env.TAS_INSECURE_COOKIES = '1';

const { startPglite } = await import('./pglite.mjs');
const temp = await startPglite();
if (!temp) {
  console.error('PGlite is not installed — run `npm install` so the devDependency is there.');
  process.exit(2);
}
process.env.DATABASE_URL = temp.url;
process.env.PGSSL = 'off';

const { getPool } = await import('../api/_lib/db.js');
const catchAll = (await import('../api/[...route].js')).default;

/* REWRITE=1 serves every request the way vercel.json's fallback rewrite does
   — /api/(.*) to /api?route=$1 — so `route` arrives as one string with slashes
   rather than the array a filesystem catch-all produces. Both shapes have to
   dispatch identically, because on Vercel both happen: the catch-all takes the
   paths it matches and the rewrite picks up the rest. */
const AS_REWRITE = process.argv.includes('--rewrite') || process.env.REWRITE === '1';

/* What the Vercel Node runtime does to every request before the handler
   runs (restoreBody in @vercel/node's helpers): it reads the whole stream
   itself, then swaps req.on so that 'data' and 'end' listeners are replayed
   from a PassThrough holding the bytes. The original request is by then
   finished — req.readableEnded is true — while listeners still get the body.
   A reader that trusts readableEnded sees an empty upload there and a full
   one on plain Node, which is exactly the gap this harness exists to close. */
async function replayLikeVercel(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const replay = new PassThrough();
  const on = replay.on.bind(replay);
  const originalOn = req.on.bind(req);
  req.read = replay.read.bind(replay);
  req.on = req.addListener = (name, cb) =>
    name === 'data' || name === 'end' ? on(name, cb) : originalOn(name, cb);
  replay.write(body);
  replay.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/^\/api\/?/, '');
  const segments = path.split('/').filter(Boolean);
  req.query = {
    ...Object.fromEntries(url.searchParams.entries()),
    route: AS_REWRITE ? path : segments,
  };
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (req.method !== 'GET' && req.method !== 'HEAD' && type === 'application/json') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw) {
      try {
        req.body = JSON.parse(raw);
      } catch {
        req.body = raw;
      }
    }
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    await replayLikeVercel(req);
  }
  try {
    await catchAll(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'threw', message: String(err && err.message) }));
    }
  }
});
await new Promise((r) => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fails.push(name + (detail ? ' — ' + detail : ''));
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

const cookies = new Map();
async function call(p, opts = {}) {
  const headers = { Accept: 'application/json', 'X-TAS-App': '1', Origin: BASE };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => k + '=' + v).join('; ');
  const res = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: 'manual',
  });
  for (const line of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
    const pair = line.split(';')[0];
    const i = pair.indexOf('=');
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (!v) cookies.delete(k);
    else cookies.set(k, v);
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 120);
  }
  return { status: res.status, data, location: res.headers.get('location') };
}

/* The raw-bytes twin of call(): an upload is not JSON, and must reach the
   route as the exact bytes that were sent. */
async function upload(p, bytes, type) {
  const headers = { 'X-TAS-App': '1', Origin: BASE, 'Content-Type': type };
  if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => k + '=' + v).join('; ');
  const res = await fetch(BASE + p, { method: 'POST', headers, body: bytes });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 120);
  }
  return { status: res.status, data };
}

const email = 'catchall-' + Date.now() + '@example.invalid';
const userIds = [];

console.log(
  '\nEvery request dispatched by ' +
    (AS_REWRITE
      ? "the vercel.json rewrite  (route arrives as 'auth/me')"
      : 'the filesystem catch-all (route arrives as an array)') +
    '\n'
);
try {
  {
    const r = await call('/api/health');
    ok('a one-segment route answers', r.status === 200, JSON.stringify(r.data).slice(0, 90));
  }
  {
    const r = await call('/api/auth/me');
    ok('a two-segment route answers', r.status === 200 && r.data.user === null);
  }
  {
    const r = await call('/api/auth/google/start?next=/work');
    ok('a three-segment route answers', r.status === 503 || r.status === 302, 'status ' + r.status);
  }
  {
    const r = await call('/api/nope');
    ok('an unknown route is a clean 404', r.status === 404 && r.data.error === 'not_found');
  }
  {
    const r = await call('/api/_lib/db');
    ok('_lib is not reachable through the catch-all', r.status === 404);
  }
  {
    const r = await call('/api/tree');
    ok('the published tree reads', r.status === 200);
  }
  {
    const r = await call('/api/trees');
    ok('a collection needs an account', r.status === 401 && r.data.error === 'auth_required');
  }
  {
    const r = await call('/api/auth/register', {
      method: 'POST',
      body: { email, password: 'a long enough passphrase' },
    });
    ok('a POST body survives the dispatch', r.status === 201, JSON.stringify(r.data).slice(0, 120));
    if (r.data && r.data.user) userIds.push(r.data.user.id);
  }
  let treeId = null;
  {
    const r = await call('/api/trees', {
      method: 'POST',
      body: {
        title: 'catch-all',
        data: {
          NODES: { q1: { q: 'Only question?', a: [{ label: 'Yes', to: 'END' }] } },
          OUT: {},
        },
      },
    });
    ok('a record saves', r.status === 201 && !!r.data.item.id, JSON.stringify(r.data).slice(0, 160));
    treeId = r.data && r.data.item && r.data.item.id;
  }
  {
    const r = await call('/api/trees/' + treeId);
    ok(
      'the [id] segment reaches the route as req.query.id',
      r.status === 200 && r.data.item && r.data.item.id === treeId,
      'status ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 120)
    );
  }
  {
    const r = await call('/api/trees/' + treeId, { method: 'PATCH', body: { title: 'renamed' } });
    ok('a PATCH on an [id] route works', r.status === 200 && r.data.item.title === 'renamed');
  }
  {
    const r = await call('/api/trees/not-a-uuid');
    ok(
      'a malformed id is rejected by the route, not the router',
      r.status === 400 && r.data.error === 'bad_id'
    );
  }
  {
    const r = await call('/api/trees/' + treeId, { method: 'DELETE' });
    ok('a DELETE on an [id] route works', r.status === 200 || r.status === 204, 'status ' + r.status);
  }
  {
    const r = await call('/api/trees?limit=1');
    ok('a real query param still arrives', r.status === 200 && Array.isArray(r.data.items));
  }
  {
    const r = await call('/api/auth/me', { method: 'DELETE' });
    ok('an unsupported method is 405, not 404', r.status === 405, 'status ' + r.status);
  }
  {
    /* Uploading is the editor's, and a local .env usually names someone
       else as the editor — so for this run, the editor is the account this
       harness just registered. */
    process.env.ADMIN_EMAIL = email;
    /* Naming an address is not enough to be the editor: the address must be
       proven (users.email_verified — by a Google sign-in, or by the owner
       running scripts/admin-user.mjs verify). A password registration proves
       nothing, so the harness does what that script does, for its own
       throwaway account. This is a routing test, not an auth test. */
    for (const id of userIds) {
      await getPool().query('update users set email_verified = true where id = $1', [id]);
    }
    /* A JPEG signature, then bytes that include every value 0–255 — the ones
       a UTF-8 decode would have replaced are exactly the ones checked for. */
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
      crypto.randomBytes(64),
    ]);
    const want = crypto.createHash('sha256').update(jpeg).digest('hex');
    const r = await upload('/api/media', jpeg, 'image/jpeg');
    ok(
      'a raw upload reaches its route byte for byte',
      r.status === 200 && r.data.hash === want,
      'status ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 160)
    );
    const res = await fetch(BASE + '/api/media/' + want);
    const back = Buffer.from(await res.arrayBuffer());
    ok(
      'the [hash] segment reaches the image route as req.query.hash',
      res.status === 200 && back.equals(jpeg),
      'status ' + res.status + ', ' + back.length + ' bytes'
    );
    const nope = await fetch(BASE + '/api/media/not-a-hash');
    ok('a malformed image hash is a 404', nope.status === 404, 'status ' + nope.status);
  }
} catch (err) {
  fails.push('threw: ' + (err.stack || err.message));
  console.error(err);
} finally {
  try {
    const pool = getPool();
    for (const id of userIds) {
      await pool.query('delete from users where id = $1', [id]).catch(() => {});
    }
    await pool.end().catch(() => {});
  } catch {
    /* nothing to clean up */
  }
  server.close();
  if (temp) await temp.stop();
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) {
  console.log(fails.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
