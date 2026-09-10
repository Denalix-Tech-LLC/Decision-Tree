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
   ========================================================================= */
import http from 'node:http';
import path from 'node:path';
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  req.query = { ...Object.fromEntries(url.searchParams.entries()), route: segments };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
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

const email = 'catchall-' + Date.now() + '@example.invalid';
const userIds = [];

console.log('\nEvery request dispatched by api/[...route].js\n');
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
