/* ===========================================================================
   LOCAL DEV SERVER
   Serves the static pages the way Vercel does (clean URLs, no-store) and runs
   the functions in /api in-process, so the whole thing — tree, editor,
   accounts, saving — works on a laptop with no Vercel CLI and no build step.

     npm run dev            → http://localhost:8777
     node dev-server.mjs 3000

   The routes live in api/_routes, out of the way of Vercel's one-function-
   per-file rule (see api/[...route].js). Resolution here still follows the
   file conventions: /api/trees hits api/_routes/trees/index.js, /api/trees/<id>
   hits api/_routes/trees/[id].js with the segment in req.query.id.

   This walks the directory rather than sharing the catch-all's import table,
   because that is what lets a route file be edited without a restart: a route
   is re-imported when anything under api/ changes. The cost is two ways of
   resolving the same URLs, so scripts/selftest.mjs checks they agree and
   fails if either grows a route the other has not heard of.

   Changing what a module in _lib exports is the one case that needs a
   restart, and the server says so.

   It serves what production serves and nothing more. The headers come from
   vercel.json — including the Content-Security-Policy, so a page whose inline
   script no longer matches its hash goes blank here, not first in
   production. Files follow .vercelignore, so .env, .pglite/ (a real database
   with real password hashes), .git/ and node_modules are never handed out.
   And it answers only to localhost: a request whose Host is anything else is
   refused, because otherwise a web page elsewhere can point its own domain at
   127.0.0.1 (DNS rebinding) and read this server — and write to it, since the
   API's same-origin check compares Origin against that same Host.

   ========================================================================= */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadEnv } from './scripts/env.mjs';
import { headersFor, readIgnore, deployable } from './scripts/csp.mjs';

loadEnv();
/* Cookies over plain http on localhost cannot carry Secure, or no browser
   will store them. Set it explicitly rather than sniffing, so the reason is
   visible here rather than surprising later. */
if (process.env.TAS_INSECURE_COOKIES === undefined) process.env.TAS_INSECURE_COOKIES = '1';

const ROOT = process.cwd();
const API = path.join(ROOT, 'api', '_routes');
const ARGS = process.argv.slice(2);
const PORT = parseInt(ARGS.find((a) => /^\d+$/.test(a)) || process.env.PORT || '8777', 10);
/* --pglite runs a throwaway Postgres in this process, persisted in .pglite/,
   so accounts and saving work locally with nothing installed. It is a
   development convenience and nothing in /api knows about it. */
const USE_PGLITE = ARGS.includes('--pglite');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/* ---- api routing -------------------------------------------------------- */

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/* Walk the URL segments through /api, preferring an exact name and falling
   back to a [param] at each level. Returns {file, params} or null. */
async function resolveApi(segments) {
  let dir = API;
  const params = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg || seg === '.' || seg === '..' || seg.startsWith('_')) return null;
    const last = i === segments.length - 1;

    if (last) {
      for (const ext of ['.js', '.mjs']) {
        const f = path.join(dir, seg + ext);
        if (await exists(f)) return { file: f, params };
      }
      const idx = path.join(dir, seg, 'index.js');
      if (await exists(idx)) return { file: idx, params };
    } else if (await exists(path.join(dir, seg))) {
      dir = path.join(dir, seg);
      continue;
    }

    /* nothing matched by name — try a dynamic segment at this level */
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    const dyn = entries.find((e) => e.name.startsWith('[') && e.name.includes(']'));
    if (!dyn) return null;
    const key = dyn.name.replace(/^\[\.{0,3}/, '').replace(/\].*$/, '');
    params[key] = decodeURIComponent(seg);
    if (dyn.isDirectory()) {
      dir = path.join(dir, dyn.name);
      if (last) {
        const idx = path.join(dir, 'index.js');
        return (await exists(idx)) ? { file: idx, params } : null;
      }
      continue;
    }
    return last ? { file: path.join(dir, dyn.name), params } : null;
  }
  const idx = path.join(dir, 'index.js');
  return (await exists(idx)) ? { file: idx, params } : null;
}

/* The newest mtime anywhere under api/, not just the route file's own, so a
   route file is re-imported when anything it might depend on changes.

   The honest limit: Node's module registry is keyed by resolved URL, and a
   re-imported route still resolves `../_lib/auth.js` to the URL it resolved to
   before — so a change to a file in _lib that only *adds* an export is picked
   up, but one that changes what a module exports needs a restart, and says so
   below when it bites. Rescanned at most every 400 ms. */
let stampAt = 0;
let stampValue = 0;
async function apiStamp() {
  const now = Date.now();
  if (now - stampAt < 400) return stampValue;
  stampAt = now;
  let newest = 0;
  const walk = async (dir) => {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (/\.(js|mjs)$/.test(e.name)) {
        const st = await fsp.stat(full).catch(() => null);
        if (st && st.mtimeMs > newest) newest = st.mtimeMs;
      }
    }
  };
  await walk(API);
  stampValue = newest;
  return newest;
}

const modCache = new Map();
async function loadHandler(file) {
  const stamp = await apiStamp();
  const hit = modCache.get(file);
  if (hit && hit.stamp === stamp) return hit.fn;
  /* ESM has no cache invalidation, so changed code is imported under a new
     specifier. Fine for a dev server; never used in production. */
  const url = pathToFileURL(file).href + '?v=' + stamp;
  const mod = await import(url);
  const fn = mod.default;
  if (typeof fn !== 'function') throw new Error(file + ' has no default export');
  modCache.set(file, { stamp, fn });
  return fn;
}

/* ---- what production would send ---------------------------------------- */

/* vercel.json and .vercelignore, re-read when they change so an `npm run csp`
   takes effect without a restart. */
const watched = new Map();
function fresh(file, parse) {
  const full = path.join(ROOT, file);
  let mtime = 0;
  try {
    mtime = fs.statSync(full).mtimeMs;
  } catch {
    /* missing: parse() decides what that means */
  }
  const hit = watched.get(file);
  if (hit && hit.mtime === mtime) return hit.value;
  const value = parse(full);
  watched.set(file, { mtime, value });
  return value;
}
const vercelConfig = () => fresh('vercel.json', (f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const ignoreRules = () => fresh('.vercelignore', () => readIgnore(ROOT));

/* The Host header, checked against the port this socket actually accepted
   on — which is the right one even when the self-test asks for port 0. */
function localHost(req) {
  const port = req.socket.localPort;
  const host = String(req.headers.host || '').toLowerCase();
  return ['localhost', '127.0.0.1', '[::1]'].some(
    (n) => host === n + ':' + port || (port === 80 && host === n)
  );
}

/* ---- static ------------------------------------------------------------- */

/* The file a URL names, or null for anything that is not plainly a path under
   the root: a malformed escape, a NUL, a drive letter, a way back out. */
function safeJoin(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const clean = path.normalize(decoded).replace(/^([/\\])+/, '');
  const full = path.join(root, clean);
  const rel = path.relative(root, full);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : full;
}

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end('<h1>404</h1><p>No such page. Try <a href="/">/</a>.</p>');
}

async function serveStatic(req, res, urlPath) {
  let file = safeJoin(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file) {
    res.statusCode = 400;
    return res.end('Bad path');
  }
  let stat = null;
  try {
    stat = await fsp.stat(file);
  } catch {
    /* clean URLs: /admin serves admin.html */
    if (!path.extname(file) && (await exists(file + '.html'))) {
      file += '.html';
      stat = await fsp.stat(file);
    }
  }
  if (stat && stat.isDirectory()) {
    const idx = path.join(file, 'index.html');
    if (await exists(idx)) {
      file = idx;
      stat = await fsp.stat(file);
    } else {
      stat = null;
    }
  }
  /* Judged on the file actually resolved — after clean URLs, directory
     indexes and any ../ — and answered with the same 404 as a file that does
     not exist, so nothing here says whether .env is there to be had. */
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (!stat || !deployable(ignoreRules(), rel, stat.isDirectory())) return notFound(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  fs.createReadStream(file).pipe(res);
}

/* ---- the server --------------------------------------------------------- */

async function requestHandler(req, res) {
  const started = Date.now();
  if (!localHost(req)) {
    res.statusCode = 421;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('This development server only answers to localhost.\n');
  }
  const url = new URL(req.url, 'http://localhost');
  let label = '';
  try {
    /* Before the handler runs, so a route that sets its own value for a
       header — the media route's sandbox policy — has the last word. */
    for (const [k, v] of headersFor(vercelConfig(), url.pathname)) res.setHeader(k, v);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
      const hit = await resolveApi(segments);
      if (!hit) {
        label = 'api 404';
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'not_found', message: 'No such endpoint.' }));
      } else {
        label = 'api ' + path.relative(ROOT, hit.file).replace(/\\/g, '/');
        req.query = { ...Object.fromEntries(url.searchParams.entries()), ...hit.params };
        const fn = await loadHandler(hit.file);
        await fn(req, res);
      }
    } else {
      label = 'static';
      await serveStatic(req, res, url.pathname);
    }
  } catch (err) {
    if (/does not provide an export named/.test(err && err.message)) {
      console.error(
        '\n[dev] A module under api/_lib changed shape. Node caches those by URL, so\n' +
          '      this needs a restart of the dev server — the edit itself is fine.\n'
      );
    }
    console.error('[dev] ' + req.method + ' ' + url.pathname + ' failed:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'server_error', message: String(err.message || err) }));
    } else {
      res.end();
    }
  }
  const ms = Date.now() - started;
  if (label.startsWith('api') && !QUIET) {
    console.log(`${req.method} ${url.pathname} → ${res.statusCode} (${ms} ms) ${label}`);
  }
}

const QUIET = process.env.TAS_QUIET === '1';

/* Exported so the self-test can run the real routes over a real socket
   instead of a mock: the parts most worth testing — cookies, the app header,
   the same-origin check — only exist on the wire. Port 0 takes any free one. */
export function startServer(port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(requestHandler);
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  let localDb = null;
  if (USE_PGLITE && !process.env.DATABASE_URL) {
    const { startPglite } = await import('./scripts/pglite.mjs');
    localDb = await startPglite(path.join(ROOT, '.pglite'));
    if (localDb) {
      process.env.DATABASE_URL = localDb.url;
      process.env.PGSSL = 'off';
      /* A PGSSLMODE=verify-full or PGSSLROOTCERT in .env is meant for the real
         database, and db.js honours a verification request over PGSSL=off —
         which would demand TLS from this in-process one, which has none. */
      delete process.env.PGSSLMODE;
      delete process.env.PGSSLROOTCERT;
    } else {
      console.error('  --pglite asked for, but the devDependency is missing. Run npm install.');
    }
  }
  const server = await startServer(PORT);
  const { isConfigured } = await import('./api/_lib/db.js');
  console.log(`\n  TAS Decision Tree — http://localhost:${server.address().port}`);
  console.log(`  static: no-store, clean URLs   api: /api/* from ./api`);
  console.log(
    localDb
      ? '  storage: a local Postgres (PGlite) in .pglite/ — for development only.\n' +
          '           Accounts and saving work; the data is on this machine and nowhere else.'
      : isConfigured()
        ? '  storage: DATABASE_URL is set — accounts and saving are live'
        : '  storage: DATABASE_URL is NOT set — guest use only, nothing can be saved\n' +
            '           copy .env.example to .env and put a Postgres URL in it,\n' +
            '           or run: npm run dev:local'
  );
  console.log('');
  const bye = async () => {
    if (localDb) await localDb.stop();
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
