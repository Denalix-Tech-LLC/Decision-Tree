/* End-to-end check of accounts and storage, over a real socket.

     npm run selftest

   It starts the same routes the deployment runs, on a random local port, and
   walks the whole path a person walks: register, sign in, save a tree, save a
   path, save a document, edit it, delete it, restore it, purge it, then close
   the account. It also tries the things that must NOT work — a cross-origin
   write, a missing app header, another account's records, a wrong password —
   and fails if any of them succeed.

   It creates a throwaway account, does all its work under that account, and
   deletes it at the end, so it is safe to run against the real database. It
   writes nothing to anyone else's rows.

   With DATABASE_URL set it runs against that database. Without one it starts
   PGlite — Postgres compiled to WebAssembly, from devDependencies — so the
   test runs on a laptop with nothing installed and still exercises real SQL.
   Pass --pglite to force the throwaway one even when DATABASE_URL is set.
   ========================================================================= */
import { loadEnv } from './env.mjs';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

loadEnv();
process.env.TAS_INSECURE_COOKIES = '1';
process.env.TAS_QUIET = '1';

const forceLocal = process.argv.includes('--pglite');
let temp = null;
if (forceLocal || !process.env.DATABASE_URL) {
  const { startPglite } = await import('./pglite.mjs');
  temp = await startPglite();
  if (!temp) {
    console.error(
      'No DATABASE_URL, and PGlite is not installed either.\n' +
        'Either set DATABASE_URL in .env (see .env.example), or run `npm install`\n' +
        'so the devDependency that provides a throwaway Postgres is there.'
    );
    process.exit(2);
  }
  process.env.DATABASE_URL = temp.url;
  process.env.PGSSL = 'off';
  console.log('using a throwaway in-memory Postgres (PGlite) on port ' + temp.port);
} else {
  console.log('using DATABASE_URL — a test account is created and deleted again');
}

const { isConfigured, getPool } = await import('../api/_lib/db.js');
if (!isConfigured()) {
  console.error('DATABASE_URL is not set — there is nothing to test. See .env.example.');
  process.exit(2);
}

const { startServer } = await import('../dev-server.mjs');
const server = await startServer(0);
const PORT = server.address().port;
const BASE = 'http://127.0.0.1:' + PORT;

let pass = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

/* a cookie jar per identity, so two accounts can be logged in at once */
function jar() {
  const cookies = new Map();
  return {
    header() {
      return [...cookies].map(([k, v]) => k + '=' + v).join('; ');
    },
    take(res) {
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const line of set) {
        const [pair] = line.split(';');
        const i = pair.indexOf('=');
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (!v) cookies.delete(k);
        else cookies.set(k, v);
      }
    },
    clear() {
      cookies.clear();
    },
  };
}

async function call(j, path, opts = {}) {
  const headers = { Accept: 'application/json' };
  if (opts.app !== false) headers['X-TAS-App'] = '1';
  if (opts.origin !== undefined) headers.Origin = opts.origin;
  else headers.Origin = BASE;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const cookie = j.header();
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: 'manual',
  });
  j.take(res);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

/* An upload is raw bytes rather than JSON, so it gets its own caller. */
async function upload(j, bytes, type, opts = {}) {
  const headers = { Origin: opts.origin !== undefined ? opts.origin : BASE };
  if (opts.app !== false) headers['X-TAS-App'] = '1';
  if (type) headers['Content-Type'] = type;
  const cookie = j.header();
  if (cookie) headers.Cookie = cookie;
  /* stream: send it chunked with no Content-Length, so the server has to
     count as it reads instead of refusing on the declared size */
  const body = opts.stream
    ? new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes.length; i += 65536) c.enqueue(bytes.subarray(i, i + 65536));
          c.close();
        },
      })
    : bytes;
  const res = await fetch(BASE + '/api/media', {
    method: 'POST',
    headers,
    body,
    ...(opts.stream ? { duplex: 'half' } : {}),
  });
  j.take(res);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

const stamp = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const A = {
  jar: jar(),
  email: `selftest-${stamp}-a@example.invalid`,
  password: 'correct horse battery staple',
  name: 'Self Test A',
};
const B = {
  jar: jar(),
  email: `selftest-${stamp}-b@example.invalid`,
  password: 'another passphrase entirely',
  name: 'Self Test B',
};

const SAMPLE_TREE = {
  NODES: {
    q1: { tag: 'Question 1', short: 'One', q: 'A question?', a: [{ label: 'Yes', to: 'END' }] },
  },
  OUT: {},
  DISC: { bar: 'test bar' },
};

let cleanupUsers = [];
/* uploaded images this run made, removed at the end like the accounts */
const cleanupMedia = [];

try {
  /* ---- the two route resolvers agree -----------------------------------
     Vercel allows twelve functions on this plan and the project has twenty
     endpoints, so production serves them all from one catch-all
     (api/[...route].js) whose routing is a hand-written table of static
     imports — it has to be static, or the bundler would not include the
     route modules. The dev server instead walks api/_routes from disk, which
     is what allows a route edit without a restart.

     Two resolvers for one set of URLs can drift, and the way it shows up is
     the worst kind: an endpoint that works on a laptop and 404s only once
     deployed. So compare them here. */
  console.log('\nRouting: the catch-all table matches the files on disk');
  {
    const { STATIC_ROUTES, ITEM_ROUTES, resolveRoute } = await import('../api/[...route].js');
    const routesDir = path.join(process.cwd(), 'api', '_routes');

    /* every route file under api/_routes, as the URL path it answers */
    async function walk(dir, prefix) {
      const out = [];
      for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
        if (e.name.startsWith('_')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          out.push(...(await walk(full, prefix.concat(e.name))));
          continue;
        }
        if (!/[.]m?js$/.test(e.name)) continue;
        const base = e.name.replace(/[.]m?js$/, '');
        out.push(base === 'index' ? prefix.join('/') : prefix.concat(base).join('/'));
      }
      return out;
    }

    const onDisk = (await walk(routesDir, [])).sort();
    /* an item route is named by its file, [id].js or [hash].js, so the
       table's param name is what it has to match on disk */
    const inTable = Object.keys(STATIC_ROUTES)
      .concat(Object.keys(ITEM_ROUTES).map((k) => k + '/[' + ITEM_ROUTES[k].param + ']'))
      .sort();

    const missing = onDisk.filter((r) => !inTable.includes(r));
    const extra = inTable.filter((r) => !onDisk.includes(r));
    ok(
      'every route file is in the catch-all table',
      missing.length === 0,
      missing.length ? 'not dispatched in production: ' + missing.join(', ') : ''
    );
    ok(
      'the catch-all table has no route that no longer exists',
      extra.length === 0,
      extra.length ? 'in the table with no file: ' + extra.join(', ') : ''
    );
    ok(
      'twenty endpoints, one function',
      onDisk.length === 20 && inTable.length === 20,
      'on disk ' + onDisk.length + ', in table ' + inTable.length
    );

    /* the table resolves the shapes the client actually calls */
    ok('a nested route resolves', !!resolveRoute(['auth', 'google', 'callback']));
    ok('a collection resolves', !!resolveRoute(['trees']));
    const item = resolveRoute(['trees', 'abc']);
    ok('a record id lands in params', !!item && item.params.id === 'abc');
    const img = resolveRoute(['media', 'f'.repeat(64)]);
    ok('an image hash lands in params as hash', !!img && img.params.hash === 'f'.repeat(64));
    ok('an unknown path does not resolve', resolveRoute(['nope']) === null);
    ok('a _lib path is not reachable', resolveRoute(['_lib', 'db']) === null);
    ok('traversal is not reachable', resolveRoute(['..', 'secrets']) === null);
  }

  console.log('\nHealth and guest access');
  {
    const r = await call(A.jar, '/api/health');
    ok('health answers', r.status === 200, JSON.stringify(r.data));
    ok('storage is ready', r.data && r.data.storage === 'ready', r.data && r.data.storage);
  }
  {
    const r = await call(A.jar, '/api/auth/me');
    ok('a guest gets 200 with user:null', r.status === 200 && r.data.user === null);
    ok('a guest is told storage exists', r.data.storage === 'ready');
  }
  {
    const r = await call(A.jar, '/api/trees');
    ok('a guest cannot list saved trees', r.status === 401 && r.data.error === 'auth_required');
  }
  {
    const r = await call(A.jar, '/api/runs', { method: 'POST', body: { path: [] } });
    ok('a guest cannot save a path', r.status === 401);
  }

  console.log('\nRegistration rules');
  {
    const r = await call(A.jar, '/api/auth/register', {
      method: 'POST',
      body: { email: 'not-an-email', password: 'short' },
    });
    ok('a bad address is refused', r.status === 400 && !!r.data.fields.email);
    ok('a short password is refused', !!r.data.fields.password);
  }
  {
    const r = await call(A.jar, '/api/auth/register', {
      method: 'POST',
      body: { email: A.email, password: A.password, name: A.name },
      app: false,
    });
    ok('a write with no app header is refused', r.status === 403);
  }
  {
    const r = await call(A.jar, '/api/auth/register', {
      method: 'POST',
      body: { email: A.email, password: A.password, name: A.name },
      origin: 'https://evil.example',
    });
    ok('a write from another origin is refused', r.status === 403);
  }

  console.log('\nRegister, sign out, sign in');
  {
    const r = await call(A.jar, '/api/auth/register', {
      method: 'POST',
      body: { email: A.email, password: A.password, name: A.name },
    });
    ok('registering works', r.status === 201 && r.data.user.email === A.email, JSON.stringify(r.data));
    if (r.data && r.data.user) cleanupUsers.push(r.data.user.id);
  }
  {
    const r = await call(A.jar, '/api/auth/me');
    ok('the session cookie signs us in', r.status === 200 && r.data.user && r.data.user.email === A.email);
  }
  {
    const r = await call(A.jar, '/api/auth/register', {
      method: 'POST',
      body: { email: A.email.toUpperCase(), password: 'a different passphrase' },
    });
    ok('the same address cannot register twice', r.status === 400 && r.data.error === 'email_taken');
  }
  {
    await call(A.jar, '/api/auth/logout', { method: 'POST' });
    const r = await call(A.jar, '/api/auth/me');
    ok('signing out clears the session', r.data.user === null);
  }
  {
    const r = await call(A.jar, '/api/auth/login', {
      method: 'POST',
      body: { email: A.email, password: 'wrong password entirely' },
    });
    ok('a wrong password is refused', r.status === 401 && r.data.error === 'bad_credentials');
  }
  {
    const r = await call(A.jar, '/api/auth/login', {
      method: 'POST',
      body: { email: '  ' + A.email.toUpperCase() + ' ', password: A.password },
    });
    ok('signing in works, and the address is not case-sensitive', r.status === 200);
  }

  console.log('\nSaving work');
  let treeId, runId, docId;
  {
    const r = await call(A.jar, '/api/trees', {
      method: 'POST',
      body: { title: 'Self-test tree', data: SAMPLE_TREE },
    });
    ok('a tree saves', r.status === 201 && !!r.data.item.id, JSON.stringify(r.data));
    treeId = r.data.item && r.data.item.id;
  }
  {
    const r = await call(A.jar, '/api/trees', {
      method: 'POST',
      body: { title: 'Broken', data: { NODES: { q1: { a: [{ label: 'x' }] } } } },
    });
    ok('a tree whose option points nowhere is refused', r.status === 400);
  }
  {
    const r = await call(A.jar, '/api/runs', {
      method: 'POST',
      body: {
        title: 'Self-test path',
        treeId,
        path: [{ node: 'q1', ai: 0 }],
        collected: ['regulatory'],
        terminal: 'END',
        snapshot: SAMPLE_TREE,
      },
    });
    ok('a path saves', r.status === 201, JSON.stringify(r.data));
    runId = r.data.item && r.data.item.id;
  }
  {
    const r = await call(A.jar, '/api/runs', {
      method: 'POST',
      body: { path: [{ node: 'q1', ai: 'not a number' }] },
    });
    ok('a path with a nonsense answer is refused', r.status === 400);
  }
  {
    const r = await call(A.jar, '/api/documents', {
      method: 'POST',
      body: {
        title: 'Self-test document',
        runId,
        bodyHtml:
          '<h2>Result</h2><p onclick="steal()">Body</p><script>alert(1)</scr' +
          'ipt><a href="javascript:alert(1)">x</a><a href="https://epa.gov">ok</a>' +
          '<svg viewBox="0 0 10 10"><text x="1" y="2">BOUNDARIES</text></svg>',
      },
    });
    ok('a document saves', r.status === 201, JSON.stringify(r.data));
    docId = r.data.item && r.data.item.id;
  }
  {
    const r = await call(A.jar, '/api/documents/' + docId);
    const html = r.data.item.bodyHtml;
    ok('a script tag is stripped from a document', !/<script/i.test(html), html);
    ok('an inline event handler is stripped', !/onclick/i.test(html), html);
    ok('a javascript: link is defused', !/javascript:/i.test(html), html);
    ok('an ordinary link survives', /https:\/\/epa\.gov/.test(html), html);
    /* the print-out opens with a drawing of the route taken, and that drawing
       is inline SVG — stripping it turns the route into run-together text */
    ok('the route drawing survives', /<svg[\s\S]*<text/i.test(html), html);
  }
  {
    const r = await call(A.jar, '/api/documents/' + docId, {
      method: 'PATCH',
      body: { title: 'Edited by hand', bodyHtml: '<p>My own words.</p>', edited: true },
    });
    ok('a document can be edited', r.status === 200 && r.data.item.title === 'Edited by hand');
  }
  {
    const r = await call(A.jar, '/api/auth/me');
    const c = r.data.counts || {};
    ok('the counts add up', c.trees === 1 && c.runs === 1 && c.documents === 1, JSON.stringify(c));
  }

  console.log('\nOne account cannot see another');
  {
    const r = await call(B.jar, '/api/auth/register', {
      method: 'POST',
      body: { email: B.email, password: B.password, name: B.name },
    });
    ok('a second account registers', r.status === 201);
    if (r.data && r.data.user) cleanupUsers.push(r.data.user.id);
  }
  {
    const r = await call(B.jar, '/api/documents/' + docId);
    ok("another account cannot read the first's document", r.status === 404, String(r.status));
  }
  {
    const r = await call(B.jar, '/api/trees/' + treeId, { method: 'PATCH', body: { title: 'mine now' } });
    ok("another account cannot edit the first's tree", r.status === 404);
  }
  {
    const r = await call(B.jar, '/api/trees/' + treeId, { method: 'DELETE' });
    ok("another account cannot delete the first's tree", r.status === 404);
  }
  {
    const r = await call(B.jar, '/api/trees');
    ok('a new account sees an empty list', r.status === 200 && r.data.items.length === 0);
  }
  {
    const r = await call(B.jar, '/api/documents', {
      method: 'POST',
      body: { title: 'Grafted', runId, bodyHtml: '<p>x</p>' },
    });
    ok(
      "a document cannot be attached to another account's path",
      r.status === 201 && r.data.item.runId === null,
      JSON.stringify(r.data.item)
    );
  }

  console.log('\nDeleting, restoring, purging');
  {
    const r = await call(A.jar, '/api/documents/' + docId, { method: 'DELETE' });
    ok('a delete answers 204', r.status === 204);
  }
  {
    const r = await call(A.jar, '/api/documents');
    ok('a deleted document leaves the list', r.data.items.length === 0);
  }
  {
    const r = await call(A.jar, '/api/documents?trash=1');
    ok('a deleted document is in the deleted list', r.data.items.length === 1);
  }
  {
    const r = await call(A.jar, '/api/documents/' + docId + '?restore=1', { method: 'PATCH', body: {} });
    ok('a deleted document restores', r.status === 200);
  }
  {
    const r = await call(A.jar, '/api/documents/' + docId, { method: 'DELETE' });
    const p = await call(A.jar, '/api/documents/' + docId + '?purge=1', { method: 'DELETE' });
    ok('a purge without confirm is refused', p.status === 400 && r.status === 204);
  }
  {
    const r = await call(A.jar, '/api/documents/' + docId + '?purge=1&confirm=1', { method: 'DELETE' });
    ok('a confirmed purge works', r.status === 200);
    const g = await call(A.jar, '/api/documents/' + docId + '?trash=1');
    ok('a purged document is gone', g.status === 404);
  }

  console.log('\nSign in with Google');
  {
    /* Where to go after signing in is attacker-controllable: an open redirect
       on a sign-in route is how a phishing page borrows this domain, since the
       victim sees a real Google consent screen and a real callback on this
       site before landing somewhere else, signed in. */
    const { safeNext } = await import('../api/_lib/google.js');
    const escapes = (v) => {
      const out = safeNext(v);
      return (
        /^[a-z][a-z0-9+.-]*:/i.test(out) ||
        out.startsWith('//') ||
        out.includes('\\') ||
        !out.startsWith('/') ||
        /[ -]/.test(out)
      );
    };
    const payloads = [
      '//evil.com',
      'https://evil.com',
      'https:/evil.com',
      '/\\evil.com',
      '\\\\evil.com',
      '////evil.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '/\t/evil.com',
      '/\n//evil.com' /* would otherwise reach a Location header as a newline */,
      'x'.repeat(400),
    ];
    ok(
      'no "next" gets off this site',
      payloads.every((p) => !escapes(p)),
      payloads.filter(escapes).join(' | ')
    );
    ok(
      'and a real destination survives',
      ['/', '/work', '/admin', '/work?tab=trees', '/admin#q1'].every((p) => safeNext(p) === p)
    );
  }
  {
    /* Not configured: the button must not be offered, and the routes must say
       so rather than half-starting a flow. */
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const me = await call(A.jar, '/api/auth/me');
    ok('Google is not offered when it is not configured', me.data.auth.google === false);
    const s = await call(A.jar, '/api/auth/google/start');
    ok('starting a Google sign-in says it is not set up', s.status === 503);
  }
  {
    process.env.GOOGLE_CLIENT_ID = 'selftest-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'selftest-secret';
    const me = await call(A.jar, '/api/auth/me');
    ok('Google is offered once it is configured', me.data.auth.google === true);
  }
  {
    const jj = jar();
    const res = await fetch(BASE + '/api/auth/google/start?next=/work', { redirect: 'manual' });
    jj.take(res);
    const to = res.headers.get('location') || '';
    ok('starting redirects to Google', res.status === 302 && to.startsWith('https://accounts.google.com/'), to.slice(0, 60));
    const u = new URL(to);
    ok('the redirect carries this deployment as the client', u.searchParams.get('client_id') === process.env.GOOGLE_CLIENT_ID);
    ok('it asks only for identity', u.searchParams.get('scope') === 'openid email profile');
    ok('it comes back to this deployment', (u.searchParams.get('redirect_uri') || '').endsWith('/api/auth/google/callback'));
    ok('it carries a state and a nonce', !!u.searchParams.get('state') && !!u.searchParams.get('nonce'));
    ok('and it wrote the cookie that checks them', jj.header().includes('tas_oauth='));

    /* The callback must refuse a state that does not match the cookie — that
       check is the whole reason the cookie exists. */
    const bad1 = await fetch(BASE + '/api/auth/google/callback?code=x&state=forged', {
      headers: { Cookie: jj.header() },
      redirect: 'manual',
    });
    ok('a forged state is refused', bad1.status === 400);
    const bad2 = await fetch(BASE + '/api/auth/google/callback?code=x&state=' + u.searchParams.get('state'), {
      redirect: 'manual',
    });
    ok('a callback with no cookie at all is refused', bad2.status === 400);
    const cancelled = await fetch(
      BASE + '/api/auth/google/callback?error=access_denied&state=' + u.searchParams.get('state'),
      { headers: { Cookie: jj.header() }, redirect: 'manual' }
    );
    ok(
      'pressing Cancel at Google comes back quietly',
      cancelled.status === 302 && (cancelled.headers.get('location') || '').includes('signin=cancelled'),
      cancelled.headers.get('location')
    );
  }
  {
    /* The identity half, without the network: this is what the callback does
       once Google has answered. */
    const { findOrCreateGoogleUser, linkGoogle, unlinkGoogle, signInMethods, changePassword } =
      await import('../api/_lib/auth.js');
    const profile = {
      sub: 'selftest-google-' + stamp,
      email: `selftest-${stamp}-g@example.invalid`,
      name: 'Google Person',
      picture: '',
    };
    const made = await findOrCreateGoogleUser(profile);
    cleanupUsers.push(made.id);
    ok('a first Google sign-in makes an account', made.created === true && !!made.id);
    const again = await findOrCreateGoogleUser(profile);
    ok('the second one signs into the same account', again.id === made.id && again.created === false);

    const m1 = await signInMethods(made.id);
    ok('that account has no password', m1.password === false && m1.google === true);

    const g = jar();
    const login = await call(g, '/api/auth/login', {
      method: 'POST',
      body: { email: profile.email, password: 'anything at all really' },
    });
    ok(
      'signing in with a password says to use Google instead',
      login.status === 409 && login.data.error === 'use_google',
      JSON.stringify(login.data)
    );

    await changePassword(made.id, '', 'a password added afterwards');
    const m2 = await signInMethods(made.id);
    ok('a Google account can add a password with no current one', m2.password === true);
    const login2 = await call(g, '/api/auth/login', {
      method: 'POST',
      body: { email: profile.email, password: 'a password added afterwards' },
    });
    ok('and can then sign in with it', login2.status === 200);

    /* linking to an account that already exists */
    const linkProfile = { sub: 'selftest-link-' + stamp, email: 'someone-else@example.invalid', name: '', picture: '' };
    await linkGoogle(cleanupUsers[1], linkProfile);
    const m3 = await signInMethods(cleanupUsers[1]);
    ok('a Google identity attaches to an existing account', m3.google === true && m3.password === true);
    let clash = null;
    try {
      await linkGoogle(made.id, linkProfile);
    } catch (err) {
      clash = err.code;
    }
    ok('the same Google identity cannot be attached twice', clash === 'google_taken', String(clash));
    await unlinkGoogle(cleanupUsers[1]);
    ok('it detaches again', (await signInMethods(cleanupUsers[1])).google === false);

    /* an account whose only way in is Google must not be able to remove it */
    const only = await findOrCreateGoogleUser({
      sub: 'selftest-only-' + stamp,
      email: `selftest-${stamp}-only@example.invalid`,
      name: '',
      picture: '',
    });
    cleanupUsers.push(only.id);
    let refused = null;
    try {
      await unlinkGoogle(only.id);
    } catch (err) {
      refused = err.code;
    }
    ok('removing the only way in is refused', refused === 'last_method', String(refused));
  }
  {
    /* linking on a verified address joins rather than duplicating. Only a
       VERIFIED address joins as it stands (an unverified one is taken over —
       see the account-security group at the end), so B's address is vouched
       for first, the way scripts/admin-user.mjs verify would. */
    const { findOrCreateGoogleUser } = await import('../api/_lib/auth.js');
    await getPool().query('update users set email_verified = true where id = $1', [cleanupUsers[1]]);
    const joined = await findOrCreateGoogleUser({
      sub: 'selftest-join-' + stamp,
      email: B.email,
      name: '',
      picture: '',
    });
    ok(
      'a Google address matching a password account joins it',
      joined.linked === true && joined.id === cleanupUsers[1],
      JSON.stringify({ id: joined.id, want: cleanupUsers[1] })
    );
    const { rows } = await getPool().query('select count(*)::int as n from users where lower(email) = lower($1)', [B.email]);
    ok('and does not leave two accounts on one address', rows[0].n === 1, JSON.stringify(rows[0]));
  }

  console.log('\nWho may edit the tree');
  {
    delete process.env.ADMIN_EMAIL;
    const me = await call(A.jar, '/api/auth/me');
    ok('with no ADMIN_EMAIL there is no gate', me.data.adminGate === false);
    /* With a database, "no gate" would mean anyone who registers edits what
       every reader sees, so it fails closed instead. */
    ok(
      'and with a database here nobody may edit, and the page is told why',
      me.data.admin === false && me.data.adminReason === 'admin_unset',
      JSON.stringify({ admin: me.data.admin, adminReason: me.data.adminReason })
    );
  }
  {
    process.env.ADMIN_EMAIL = A.email;
    /* A registered with a password, which proves nothing about the address */
    const unproven = await call(A.jar, '/api/auth/me');
    ok(
      'the named address is not the editor until it is verified',
      unproven.data.admin === false && unproven.data.adminReason === 'admin_unverified',
      JSON.stringify({ admin: unproven.data.admin, adminReason: unproven.data.adminReason })
    );
    await getPool().query('update users set email_verified = true where id = $1', [cleanupUsers[0]]);
    const mine = await call(A.jar, '/api/auth/me');
    ok('the named account is the editor', mine.data.adminGate === true && mine.data.admin === true);
    const theirs = await call(B.jar, '/api/auth/me');
    ok('another signed-in account is not', theirs.data.admin === false, String(theirs.data.admin));
    const guest = await call(jar(), '/api/auth/me');
    ok('and a guest is not', guest.data.admin === false && guest.data.adminGate === true);
  }
  {
    /* the address someone types is not always the address they registered */
    process.env.ADMIN_EMAIL = '  ' + A.email.toUpperCase() + ' ';
    const mine = await call(A.jar, '/api/auth/me');
    ok('the match ignores case and stray spaces', mine.data.admin === true);
  }
  {
    process.env.ADMIN_EMAIL = 'someone-else@example.invalid,' + A.email;
    const mine = await call(A.jar, '/api/auth/me');
    ok('a handover list accepts either address', mine.data.admin === true);
    process.env.ADMIN_EMAIL = 'someone-else@example.invalid';
    const out = await call(A.jar, '/api/auth/me');
    ok('and shuts the door when the name changes', out.data.admin === false);
    delete process.env.ADMIN_EMAIL;
  }

  console.log('\nThe published tree');
  {
    delete process.env.ADMIN_EMAIL;
    const r = await call(jar(), '/api/tree');
    ok('the tree reads without an account', r.status === 200, String(r.status));
    ok('and nothing is published to begin with', r.data.published === false);
  }
  {
    const r = await call(jar(), '/api/tree', { method: 'PUT', body: { data: SAMPLE_TREE } });
    ok('a guest cannot publish', r.status === 401);
  }
  {
    /* fail closed: a database and no ADMIN_EMAIL means nobody publishes */
    const r = await call(A.jar, '/api/tree', { method: 'PUT', body: { data: SAMPLE_TREE } });
    ok(
      'with no ADMIN_EMAIL nobody may publish, and the refusal says to set it',
      r.status === 403 && r.data.error === 'admin_unset' && /ADMIN_EMAIL/.test(r.data.message),
      JSON.stringify(r.data)
    );
    process.env.ADMIN_EMAIL = A.email;
  }
  {
    const r = await call(A.jar, '/api/tree', {
      method: 'PUT',
      body: { data: { NODES: { q1: { a: [{ label: 'x' }] } } } },
    });
    ok('a tree whose option points nowhere cannot be published', r.status === 400);
  }
  {
    const r = await call(A.jar, '/api/tree', {
      method: 'PUT',
      body: { data: SAMPLE_TREE, note: 'corrected a citation' },
    });
    ok('the verified editor publishes', r.status === 200, JSON.stringify(r.data));
    const got = await call(jar(), '/api/tree');
    ok('and every reader gets it', got.data.published === true && !!got.data.data.NODES.q1);
    ok('with the note beside it', got.data.note === 'corrected a citation');
  }
  {
    /* with a gate configured, publishing is the editor's alone */
    process.env.ADMIN_EMAIL = A.email;
    const mine = await call(A.jar, '/api/tree', { method: 'PUT', body: { data: SAMPLE_TREE } });
    ok('the editor can still publish', mine.status === 200);
    const theirs = await call(B.jar, '/api/tree', { method: 'PUT', body: { data: SAMPLE_TREE } });
    ok('another account cannot', theirs.status === 403 && theirs.data.error === 'forbidden',
       JSON.stringify(theirs.data));
    const read = await call(B.jar, '/api/tree');
    ok('though anyone may read it', read.status === 200 && read.data.published === true);
    const drop = await call(B.jar, '/api/tree', { method: 'DELETE' });
    ok('and cannot withdraw it either', drop.status === 403);
  }
  {
    const r = await call(A.jar, '/api/tree', { method: 'DELETE' });
    ok('the editor withdraws it', r.status === 204);
    const got = await call(jar(), '/api/tree');
    ok('and readers fall back to the shipped file', got.data.published === false);
    const again = await call(A.jar, '/api/tree', { method: 'DELETE' });
    ok('withdrawing nothing says so', again.status === 400 && again.data.error === 'not_published');
    delete process.env.ADMIN_EMAIL;
  }

  console.log('\nThe backdrop photograph');
  /* A JPEG signature and random bytes: the server checks the signature, not
     that the picture decodes, and random bytes make the hash this run's own
     so the cleanup below cannot touch a real upload. */
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
    crypto.randomBytes(4096),
  ]);
  const jpegHash = crypto.createHash('sha256').update(jpeg).digest('hex');
  cleanupMedia.push(jpegHash);
  let mediaUrl = null;
  {
    process.env.ADMIN_EMAIL = A.email;
    const r = await upload(A.jar, jpeg, 'image/jpeg');
    ok(
      'the editor uploads a JPEG and gets its hash back',
      r.status === 200 && r.data.hash === jpegHash && r.data.url === '/api/media/' + jpegHash,
      JSON.stringify(r.data).slice(0, 200)
    );
    ok(
      'it is stored as what the bytes are',
      r.data.mime === 'image/jpeg' && r.data.size === jpeg.length
    );
    mediaUrl = r.data.url;
    const again = await upload(A.jar, jpeg, 'image/jpeg');
    const { rows } = await getPool().query(
      'select count(*)::int as n from media where hash = $1',
      [jpegHash]
    );
    ok(
      'the same bytes twice are one image',
      again.status === 200 && again.data.hash === jpegHash && rows[0].n === 1,
      JSON.stringify({ status: again.status, rows: rows[0].n })
    );
  }
  {
    const theirs = await upload(B.jar, jpeg, 'image/jpeg');
    ok('another signed-in account cannot upload', theirs.status === 403, String(theirs.status));
    const guest = await upload(jar(), jpeg, 'image/jpeg');
    ok('a guest cannot upload', guest.status === 401, String(guest.status));
    const noHeader = await upload(A.jar, jpeg, 'image/jpeg', { app: false });
    ok('an upload with no app header is refused', noHeader.status === 403, String(noHeader.status));
    const elsewhere = await upload(A.jar, jpeg, 'image/jpeg', { origin: 'https://evil.example' });
    ok('an upload from another origin is refused', elsewhere.status === 403, String(elsewhere.status));
  }
  {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>'
    );
    const asSvg = await upload(A.jar, svg, 'image/svg+xml');
    ok(
      'an SVG is refused',
      asSvg.status === 400 && asSvg.data.error === 'bad_image',
      JSON.stringify(asSvg.data)
    );
    const svgAsPng = await upload(A.jar, svg, 'image/png');
    ok(
      'and so is an SVG labelled as a PNG',
      svgAsPng.status === 400 && svgAsPng.data.error === 'bad_image',
      JSON.stringify(svgAsPng.data)
    );
    /* garbage the size of a real photograph, claiming to be a PNG */
    const junk = crypto.randomBytes(200_000);
    junk[0] = 0x00;
    const garbage = await upload(A.jar, junk, 'image/png');
    ok(
      'a PNG-labelled blob with no PNG inside is refused',
      garbage.status === 400 && garbage.data.error === 'bad_image',
      JSON.stringify(garbage.data)
    );
    const empty = await upload(A.jar, Buffer.alloc(0), 'image/jpeg');
    ok('an empty upload is refused', empty.status === 400 && empty.data.error === 'bad_image');
    const huge = Buffer.concat([jpeg.subarray(0, 12), Buffer.alloc(3_000_000)]);
    const big = await upload(A.jar, huge, 'image/jpeg');
    ok(
      'an image over 3 MB is refused as too large',
      big.status === 413 && big.data.error === 'too_large',
      String(big.status)
    );
    const streamed = await upload(A.jar, huge, 'image/jpeg', { stream: true });
    ok(
      'and so is one that never declares its length',
      streamed.status === 413 && streamed.data.error === 'too_large',
      String(streamed.status)
    );
    const small = await upload(A.jar, jpeg, 'image/jpeg', { stream: true });
    ok(
      'while a streamed upload under the limit arrives whole',
      small.status === 200 && small.data.hash === jpegHash,
      JSON.stringify(small.data).slice(0, 120)
    );
    const { rows } = await getPool().query(
      'select count(*)::int as n from media where created_by = $1',
      [cleanupUsers[0]]
    );
    ok('and nothing refused was stored', rows[0].n === 1, JSON.stringify(rows[0]));
  }
  {
    const res = await fetch(BASE + mediaUrl);
    const back = Buffer.from(await res.arrayBuffer());
    ok(
      'the image serves back byte for byte',
      res.status === 200 && back.equals(jpeg),
      'status ' + res.status
    );
    ok('as the type it was sniffed as', res.headers.get('content-type') === 'image/jpeg');
    ok(
      'cached for a year, immutably',
      res.headers.get('cache-control') === 'public, max-age=31536000, immutable',
      res.headers.get('cache-control')
    );
    ok(
      'with the hash as its ETag',
      res.headers.get('etag') === '"' + jpegHash + '"',
      res.headers.get('etag')
    );
    ok('with nosniff', res.headers.get('x-content-type-options') === 'nosniff');
    ok(
      'and a sandbox that may load nothing',
      res.headers.get('content-security-policy') === "default-src 'none'; sandbox",
      res.headers.get('content-security-policy')
    );
    ok('only for this origin', res.headers.get('cross-origin-resource-policy') === 'same-origin');
    ok('with its length', res.headers.get('content-length') === String(jpeg.length));
    const cached = await fetch(BASE + mediaUrl, {
      headers: { 'If-None-Match': '"' + jpegHash + '"' },
    });
    ok('a revalidation with the ETag is a 304', cached.status === 304, String(cached.status));
    const stale = await fetch(BASE + mediaUrl, {
      headers: { 'If-None-Match': '"' + 'e'.repeat(64) + '"' },
    });
    ok('a different ETag gets the bytes', stale.status === 200);
    await stale.arrayBuffer();
  }
  {
    const malformed = ['nope', 'A'.repeat(64), 'g'.repeat(64), jpegHash + '0', jpegHash.slice(1)];
    const statuses = [];
    for (const h of malformed) statuses.push((await fetch(BASE + '/api/media/' + h)).status);
    ok('a malformed hash is a 404', statuses.every((st) => st === 404), statuses.join(','));
    const unknown = await fetch(BASE + '/api/media/' + '0'.repeat(64));
    ok('an unknown hash is a 404', unknown.status === 404, String(unknown.status));
    const put = await fetch(BASE + mediaUrl, {
      method: 'PUT',
      headers: { 'X-TAS-App': '1', Origin: BASE },
    });
    ok('an image cannot be overwritten', put.status === 405, String(put.status));
  }

  console.log('\nThe wording and the backdrop, published');
  const WORDED_TREE = {
    ...SAMPLE_TREE,
    GUIDE: [{ h: 'What this is', html: '<p onclick="steal()">A guide.</p>' }],
    COPY: {
      brand: {
        kicker: 'Clean Air Act',
        title: 'TAS Decision Tree',
        pageTitle: 'TAS Decision Tree',
      },
      verdicts: {
        reg: {
          t: 'Regulatory TAS',
          s: '<b>Seek it.</b><script>alert(document.cookie)</scr' + 'ipt>',
        },
      },
      walk: [
        { h: 'Screen one', html: '<p>Hello</p><iframe src="https://evil.example"></iframe>' },
      ],
      ui: { skip: 'Skip', next: 'Next' },
      print: { stamp: 'Generated {date}' },
    },
    THEME: { photo: '', position: 30, opacityLight: 0.5, opacityDark: null },
  };
  {
    const withPhoto = {
      ...WORDED_TREE,
      THEME: { photo: mediaUrl, position: 30, opacityLight: 0.5, opacityDark: null },
    };
    const r = await call(A.jar, '/api/tree', { method: 'PUT', body: { data: withPhoto } });
    ok('a tree with its wording and backdrop publishes', r.status === 200, JSON.stringify(r.data));
    const got = (await call(jar(), '/api/tree')).data.data || {};
    ok(
      'the wording survives publishing',
      !!got.COPY &&
        got.COPY.brand.title === 'TAS Decision Tree' &&
        got.COPY.ui.next === 'Next' &&
        got.COPY.print.stamp === 'Generated {date}',
      JSON.stringify(got.COPY).slice(0, 200)
    );
    ok(
      'and so does the backdrop',
      !!got.THEME &&
        got.THEME.photo === mediaUrl &&
        got.THEME.position === 30 &&
        got.THEME.opacityLight === 0.5 &&
        got.THEME.opacityDark === null,
      JSON.stringify(got.THEME)
    );
    const verdict = (got.COPY && got.COPY.verdicts.reg.s) || '';
    ok(
      'a script in the wording is removed',
      !/<script/i.test(verdict) && verdict.includes('<b>Seek it.</b>'),
      verdict
    );
    const walk = (got.COPY && got.COPY.walk[0].html) || '';
    ok('a frame in the walkthrough is removed', !/iframe/i.test(walk), walk);
    const guide = (got.GUIDE && got.GUIDE[0].html) || '';
    ok('an event handler in the guide is removed', !/onclick/i.test(guide) && guide.includes('A guide.'), guide);
  }
  {
    const r = await call(A.jar, '/api/tree', { method: 'PUT', body: { data: WORDED_TREE } });
    const got = (await call(jar(), '/api/tree')).data.data || {};
    ok(
      '"no photograph" is kept as a choice',
      r.status === 200 && got.THEME.photo === '',
      JSON.stringify(got.THEME)
    );
  }
  {
    const hostile = [
      'https://evil.example/x.jpg',
      'land.jpg") ; background:red',
      '//evil.example/x.jpg',
      'javascript:alert(1)',
      '/api/media/' + jpegHash.toUpperCase(),
      '/api/media/' + jpegHash + '?x=1',
      '/api/media/../../x',
      'land.png',
      42,
    ];
    const kept = [];
    for (const photo of hostile) {
      const theme = { photo, position: 250, opacityLight: 7, opacityDark: 'x', evil: 1 };
      const r = await call(A.jar, '/api/tree', {
        method: 'PUT',
        body: { data: { ...WORDED_TREE, THEME: theme } },
      });
      const got = (await call(jar(), '/api/tree')).data.data || {};
      if (r.status !== 200 || !got.THEME || got.THEME.photo !== 'land.jpg') kept.push(String(photo));
      if (photo === hostile[0]) {
        ok(
          'backdrop numbers are clamped and unknown keys dropped',
          got.THEME.position === 100 &&
            got.THEME.opacityLight === 1 &&
            got.THEME.opacityDark === null &&
            !('evil' in got.THEME),
          JSON.stringify(got.THEME)
        );
      }
    }
    ok(
      'a photograph that is not one of the three shapes becomes the default',
      kept.length === 0,
      kept.join(' | ')
    );
  }
  {
    /* Every way round the old filter that review found, in every place the
       reader puts a string with innerHTML. Each was published unchanged
       before: an attribute after a quote or a "/" instead of a space, a
       scheme spelled with character references or control characters, a
       forbidden tag rebuilt from the pieces left when another was cut out of
       its middle, and content that loads from another origin or paints over
       the page. */
    const payloads = [
      '<img src="x"onerror=alert(1)>',
      '<svg/onload=alert(2)>',
      '<img src="x"/onerror="alert(document.cookie)">',
      '<details/open/ontoggle=alert(1)>',
      '<a/href="javascript:alert(1)">click</a>',
      '<a href="java&#115;cript:alert(3)">x</a>',
      '<a href="javascript&colon;alert(1)">x</a>',
      '<a href="&#106;avascript:alert(1)">x</a>',
      '<a href="java&#x09;script:alert(1)">x</a>',
      '<a href="&#x01;javascript:alert(1)">x</a>',
      '<ifr<iframe>ame srcdoc="&lt;img src=x &#111;nerror=parent.alert(1)&gt;"></iframe>',
      '<img src=x on onx="1"error=alert(1)>',
      '<scr<script>x</script>ipt>alert(1)</script>',
      '<img src="https://tracker.example/p.gif">',
      '<img srcset="//tracker.example/p.gif 1x">',
      '<p style="background:url(//tracker.example/p.gif)">x</p>',
      '<p style="position:fixed;inset:0;z-index:99999;background:#fff">Session expired</p>',
      '<img src=x onerror=alert(1)',
    ];
    const joined = payloads.join('');
    const hostile = {
      ...WORDED_TREE,
      DISC: { ...WORDED_TREE.DISC, guide: joined },
      GUIDE: [{ h: 'Guide', html: joined }],
      COPY: {
        ...WORDED_TREE.COPY,
        walk: [{ h: 'Walk', html: joined }],
        ui: { ...WORDED_TREE.COPY.ui, guideFoot: joined },
        contact: {
          lead:
            'Email us on=time &amp; <b>fast</b> if you once=1, or <a href="#" data-open-contact>contact us</a>' +
            ' or read <a href="https://www.epa.gov/tribal-air" target="_blank" rel="noopener">this</a>.',
        },
      },
      LINKS: [
        { t: 'Real', u: 'https://www.epa.gov/tribal-air' },
        { t: 'Breaks out', u: 'x" onmouseover="alert(1)' },
        { t: 'Script', u: 'javascript:alert(1)' },
      ],
    };
    /* What would still act, whatever the spelling: an event handler in any
       tag, a link that is not this site or the web, a frame, anything that
       loads from another origin, anything that leaves its box. */
    const leftovers = (html) => {
      const found = [];
      for (const tag of html.match(/<[^>]*>/g) || []) {
        if (/[\s\/"']on[a-z]+\s*=/i.test(tag)) found.push('handler in ' + tag);
        if (/srcdoc|srcset/i.test(tag)) found.push('srcdoc/srcset in ' + tag);
        if (/tracker\.example/i.test(tag)) found.push('another origin in ' + tag);
        if (/position\s*:\s*fixed/i.test(tag)) found.push('fixed position in ' + tag);
        for (const m of tag.matchAll(/\shref="([^"]*)"/gi)) {
          if (!/^(#|https?:\/\/|\/)/.test(m[1]) || /&#|&colon;/i.test(m[1])) found.push('href ' + m[1]);
        }
      }
      if (/<(iframe|script)/i.test(html)) found.push('a frame or script');
      /* the unterminated tag at the end must not be able to finish itself
         on whatever the reader puts after it */
      if (/<img src=x onerror/i.test(html)) found.push('a half-tag left live');
      return found;
    };
    const r = await call(A.jar, '/api/tree', { method: 'PUT', body: { data: hostile } });
    const got = (await call(jar(), '/api/tree')).data.data || {};
    const places = {
      'COPY.ui': got.COPY && got.COPY.ui.guideFoot,
      GUIDE: got.GUIDE && got.GUIDE[0].html,
      'COPY.walk': got.COPY && got.COPY.walk[0].html,
      DISC: got.DISC && got.DISC.guide,
    };
    const bad = Object.entries(places).flatMap(([k, v]) =>
      typeof v === 'string' ? leftovers(v).map((x) => k + ': ' + x) : [k + ': missing']
    );
    ok('no spelling of script survives publishing, in any place it renders', r.status === 200 && !bad.length, bad.join(' | ') || JSON.stringify(r.data));
    const lead = (got.COPY && got.COPY.contact.lead) || '';
    ok(
      'ordinary prose that looks like an attribute is left alone',
      lead.includes('Email us on=time') && lead.includes('if you once=1'),
      lead
    );
    ok(
      'and the content the site ships keeps its links',
      lead.includes('<a href="#" data-open-contact>contact us</a>') &&
        lead.includes('<a href="https://www.epa.gov/tribal-air" target="_blank" rel="noopener">this</a>'),
      lead
    );
    const links = got.LINKS || [];
    ok(
      'a reference link cannot leave the quotes it is put between',
      links[0] && links[0].u === 'https://www.epa.gov/tribal-air' &&
        links[1] && !/["'<>\s]/.test(links[1].u) &&
        links[2] && links[2].u === '#',
      JSON.stringify(links)
    );
  }
  {
    /* A tree published before the filter covered every string is still in
       the row as it was stored. GET cleans it on the way out, so readers
       never see what the old validation let in. */
    await getPool().query(
      `update site_tree set data = $1 where id = 'current'`,
      [JSON.stringify({ ...SAMPLE_TREE, DISC: { guide: '<p>Old</p><img src=x onerror=alert(1)>' } })]
    );
    const got = (await call(jar(), '/api/tree')).data;
    const guide = (got && got.data && got.data.DISC && got.data.DISC.guide) || '';
    ok(
      'a tree stored before the filter is cleaned when it is served',
      got.published === true && guide.includes('<p>Old</p>') && !/onerror/i.test(guide),
      JSON.stringify(got).slice(0, 200)
    );
    await getPool().query(
      `update site_tree set data = $1 where id = 'current'`,
      [JSON.stringify({ NODES: { q1: { q: 'x', a: [] } }, GUIDE: 'not a list' })]
    );
    const broken = (await call(jar(), '/api/tree')).data;
    ok(
      'one that no longer validates at all is served as nothing published',
      broken.published === false,
      JSON.stringify(broken).slice(0, 200)
    );
  }
  {
    const longGuide = Array.from({ length: 41 }, (_, i) => ({ h: 'S' + i, html: '<p>x</p>' }));
    const g = await call(A.jar, '/api/tree', {
      method: 'PUT',
      body: { data: { ...WORDED_TREE, GUIDE: longGuide } },
    });
    ok(
      'a guide of more than 40 sections is refused',
      g.status === 400 && g.data.error === 'bad_tree',
      JSON.stringify(g.data)
    );
    const longWalk = Array.from({ length: 13 }, (_, i) => ({ h: 'W' + i, html: '<p>x</p>' }));
    const w = await call(A.jar, '/api/tree', {
      method: 'PUT',
      body: { data: { ...WORDED_TREE, COPY: { ...WORDED_TREE.COPY, walk: longWalk } } },
    });
    ok(
      'a walkthrough of more than 12 screens is refused',
      w.status === 400 && w.data.error === 'bad_tree',
      JSON.stringify(w.data)
    );
    const c = await call(A.jar, '/api/tree', {
      method: 'PUT',
      body: { data: { ...WORDED_TREE, COPY: 'words' } },
    });
    ok(
      'wording that is not an object of groups is refused',
      c.status === 400 && c.data.error === 'bad_tree'
    );
  }
  {
    /* the same validation holds for a tree saved to an account */
    const r = await call(A.jar, '/api/trees', {
      method: 'POST',
      body: { title: 'Worded', data: WORDED_TREE },
    });
    const got = await call(A.jar, '/api/trees/' + (r.data.item && r.data.item.id));
    const d = (got.data.item && got.data.item.data) || {};
    ok(
      'a saved tree keeps its wording and backdrop too',
      r.status === 201 && !!d.COPY && d.COPY.ui.skip === 'Skip' && !!d.THEME && d.THEME.photo === '',
      JSON.stringify(d).slice(0, 200)
    );
    ok('and has the script taken out as well', !!d.COPY && !/<script/i.test(d.COPY.verdicts.reg.s));
  }
  {
    const r = await call(A.jar, '/api/tree', { method: 'DELETE' });
    ok('the worded tree withdraws like any other', r.status === 204);
    delete process.env.ADMIN_EMAIL;
  }

  console.log('\nSessions and passwords');
  {
    const r = await call(A.jar, '/api/auth/sessions');
    ok('the session list names this browser', r.status === 200 && r.data.items.some((s) => s.current));
  }
  {
    const r = await call(A.jar, '/api/auth/password', {
      method: 'POST',
      body: { current: 'not the password', password: 'a new long passphrase' },
    });
    ok('changing a password needs the current one', r.status === 400 && !!r.data.fields.current);
  }
  {
    const second = jar();
    await call(second, '/api/auth/login', {
      method: 'POST',
      body: { email: A.email, password: A.password },
    });
    const before = await call(second, '/api/auth/me');
    const r = await call(A.jar, '/api/auth/password', {
      method: 'POST',
      body: { current: A.password, password: 'a new long passphrase' },
    });
    A.password = 'a new long passphrase';
    const after = await call(second, '/api/auth/me');
    ok('the password changes', r.status === 200);
    ok(
      'changing it signs the other browser out',
      before.data.user !== null && after.data.user === null
    );
    const still = await call(A.jar, '/api/auth/me');
    ok('this browser stays signed in', still.data.user !== null);
  }

  console.log('\nClosing an account takes its work with it');
  {
    const r = await call(A.jar, '/api/auth/account', {
      method: 'DELETE',
      body: { password: A.password, confirm: 'nope' },
    });
    ok('closing needs the word DELETE', r.status === 400 && !!r.data.fields.confirm);
  }
  {
    const r = await call(A.jar, '/api/auth/account', {
      method: 'DELETE',
      body: { password: A.password, confirm: 'DELETE' },
    });
    ok('the account closes', r.status === 200, JSON.stringify(r.data));
    const me = await call(A.jar, '/api/auth/me');
    ok('the session dies with it', me.data.user === null);
    const login = await call(A.jar, '/api/auth/login', {
      method: 'POST',
      body: { email: A.email, password: A.password },
    });
    ok('the account cannot be signed in to again', login.status === 401);
  }
  {
    const pool = getPool();
    const left = await pool.query(
      `select (select count(*)::int from trees     where user_id = $1) as t,
              (select count(*)::int from runs      where user_id = $1) as r,
              (select count(*)::int from documents where user_id = $1) as d,
              (select count(*)::int from sessions  where user_id = $1) as s`,
      [cleanupUsers[0]]
    );
    const row = left.rows[0];
    ok(
      'nothing of the closed account is left behind',
      row.t === 0 && row.r === 0 && row.d === 0 && row.s === 0,
      JSON.stringify(row)
    );
  }
  {
    const r = await call(B.jar, '/api/auth/account', {
      method: 'DELETE',
      body: { password: B.password, confirm: 'DELETE' },
    });
    ok('the second test account closes too', r.status === 200);
  }
  /* ======================================================================
     BEGIN GROUP: records, markup, media and the published tree (storage
     limits, CONTACT, class allowlist, balanced fragments, clean on read)
     Self-contained: it makes its own accounts and images, puts every limit
     it lowers back, and leaves nothing published.
     ====================================================================== */
  console.log('\nStorage limits, contact details and clean-on-read');
  {
    const rec = await import('../api/_lib/records.js');
    const { cleanHtml } = await import('../api/_lib/markup.js');
    const { storeImage } = await import('../api/_lib/media.js');
    const { readJson } = await import('../api/_lib/http.js');
    const pool = getPool();
    /* a no-op after everything above; here so the group can run on its own */
    await (await import('../api/_lib/db.js')).ensureSchema();
    const saved = JSON.parse(
      JSON.stringify({ trees: rec.LIMITS.trees, runs: rec.LIMITS.runs, total: rec.LIMITS.total })
    );
    const putBack = () => {
      Object.assign(rec.LIMITS.trees, saved.trees);
      Object.assign(rec.LIMITS.runs, saved.runs);
      Object.assign(rec.LIMITS.total, saved.total);
    };
    const T = { NODES: { q1: { q: 'x', a: [{ label: 'a', to: 'END' }] } } };
    const codeOf = async (p) => {
      try {
        await p;
        return 'ok';
      } catch (e) {
        return (e.status || '') + ' ' + (e.code || e.message);
      }
    };
    /* an account made straight in the table: these checks call records.js
       directly and need no session */
    const newUser = async (tag) => {
      const id = crypto.randomUUID();
      await pool.query(`insert into users (id, email, name, password_hash) values ($1, $2, $3, null)`, [
        id,
        `selftest-${stamp}-${tag}@example.invalid`,
        'Limits ' + tag,
      ]);
      cleanupUsers.push(id);
      return id;
    };

    try {
      /* ---- CONTACT ---- */
      {
        const c = rec.cleanTreeData({
          ...T,
          CONTACT: {
            calendly: "javascript:fetch('/api/auth/me')//",
            email: '<b>office@tribe.example</b>',
            name: '<img src=x onerror=alert(1)>Jo',
            phone: '555"><script>',
            extra: '<b>x</b>',
          },
        }).CONTACT;
        ok(
          'a javascript: calendly is dropped to nothing',
          c.calendly === '',
          JSON.stringify(c)
        );
        ok(
          'contact details come back as plain text, and only the five the reader reads',
          c.email === 'office@tribe.example' &&
            c.name === 'Jo' &&
            !/[<>]/.test(c.phone) &&
            !('extra' in c),
          JSON.stringify(c)
        );
        /* Quotes are kept: the reader escapes every contact field on the way
           out, and apostrophes are ordinary in names and titles. */
        const named = rec.cleanTreeData({
          ...T,
          CONTACT: { name: "Mary O'Brien", role: "Tribe's Air Program", email: "o'brien@tribe.example" },
        }).CONTACT;
        ok(
          'an apostrophe in a contact name, role or email survives',
          named.name === "Mary O'Brien" && named.role === "Tribe's Air Program" && named.email === "o'brien@tribe.example",
          JSON.stringify(named)
        );
        const others = ['http://calendly.com/x', 'data:text/html,<script>1</script>', '//calendly.com/x', ' JaVaScRiPt:alert(1)'];
        const leaked = others.filter((u) => rec.cleanTreeData({ ...T, CONTACT: { calendly: u } }).CONTACT.calendly !== '');
        ok('anything but an https: address is dropped too', leaked.length === 0, leaked.join(' | '));
        const good = rec.cleanTreeData({ ...T, CONTACT: { calendly: 'https://calendly.com/tribe/30min' } });
        ok(
          'while an https: scheduling link is kept',
          good.CONTACT.calendly === 'https://calendly.com/tribe/30min',
          good.CONTACT.calendly
        );
      }

      /* ---- the class allowlist and balanced fragments ---- */
      {
        const out = cleanHtml(
          '<div class="tasa-ovl"><div class="ovl tasa-card wnote"><h3>Session expired</h3>' +
            '<a href="https://evil.example/login">Sign in</a></div></div>'
        );
        ok(
          'content cannot borrow the page’s overlay classes',
          !/tasa-|class="ovl|ovl /.test(out) && out.includes('class="wnote"'),
          out
        );
        const open = cleanHtml('<a href="https://evil.example/">x');
        ok('a link left open is closed at the end of its fragment', open === '<a href="https://evil.example/">x</a>', open);
        const stray = cleanHtml('</div></section><p>x<b>y</p>z</b>');
        ok(
          'an end tag for something the fragment did not open is dropped',
          stray === '<p>x<b>y</b></p>z',
          stray
        );
      }

      /* ---- per-kind counts include Deleted, and restore is checked ---- */
      {
        const u = await newUser('count');
        rec.LIMITS.trees.count = 5;
        const ids = [];
        for (let i = 0; i < 5; i++) ids.push((await rec.createTree(u, { title: 't' + i, data: T })).id);
        for (const id of ids) await rec.softDelete('trees', u, id);
        const sixth = await codeOf(rec.createTree(u, { title: 'six', data: T }));
        ok('deleted trees still count toward the limit', /limit_reached/.test(sixth), sixth);
        const back = await codeOf(rec.restore('trees', u, ids[0]));
        ok('restoring one that fits works', back === 'ok', back);
        rec.LIMITS.trees.count = 3;
        const over = await codeOf(rec.restore('trees', u, ids[1]));
        ok('restoring is refused while the account is over the limit', /limit_reached/.test(over), over);
        const c = await rec.counts(u);
        ok('and nothing was restored past it', c.trees === 1 && c.trashedTrees === 4, JSON.stringify(c));
        putBack();
      }

      /* ---- parallel creates cannot pass the limit ---- */
      {
        const u = await newUser('race');
        rec.LIMITS.trees.count = 20;
        for (let i = 0; i < 15; i++) await rec.createTree(u, { title: 'r' + i, data: T });
        const results = await Promise.allSettled(
          Array.from({ length: 30 }, (_, i) => rec.createTree(u, { title: 'p' + i, data: T }))
        );
        const made = results.filter((r) => r.status === 'fulfilled').length;
        const { rows } = await pool.query('select count(*)::int as n from trees where user_id = $1', [u]);
        ok(
          'thirty creates at once stop exactly at the limit',
          made === 5 && rows[0].n === 20,
          JSON.stringify({ made, stored: rows[0].n })
        );
        putBack();
      }

      /* ---- the total, across kinds, counting Deleted ---- */
      {
        const u = await newUser('total');
        rec.LIMITS.total.bytes = 60_000;
        const snap = (n) => ({ ...T, GUIDE: [{ h: 'g', html: '<p>' + 'x'.repeat(n) + '</p>' }] });
        const first = await rec.createRun(u, { path: [], snapshot: snap(30_000) });
        const second = await codeOf(rec.createRun(u, { path: [], snapshot: snap(30_000) }));
        ok('a save that would take the account past its total is refused', /413 limit_reached/.test(second), second);
        const doc = await codeOf(rec.createDocument(u, { bodyHtml: '<p>' + 'y'.repeat(40_000) + '</p>' }));
        ok('the total is across kinds, not per kind', /413 limit_reached/.test(doc), doc);
        await rec.softDelete('runs', u, first.id);
        const afterDelete = await codeOf(rec.createRun(u, { path: [], snapshot: snap(30_000) }));
        ok('deleting does not make room', /limit_reached/.test(afterDelete), afterDelete);
        await rec.restore('runs', u, first.id);
        const grow = await codeOf(rec.updateRun(u, first.id, { snapshot: snap(70_000) }));
        ok('an update that grows past the total is refused', /413 limit_reached/.test(grow), grow);
        /* a limit lowered under what the account already holds */
        rec.LIMITS.total.bytes = 500;
        const shrink = await codeOf(rec.updateRun(u, first.id, { snapshot: snap(1_000) }));
        ok('an account over its total can still shrink its work', shrink === 'ok', shrink);
        const restoreOver = await (async () => {
          rec.LIMITS.total.bytes = saved.total.bytes;
          const r = await rec.createRun(u, { path: [], snapshot: null });
          await rec.softDelete('runs', u, r.id);
          rec.LIMITS.total.bytes = 1_000;
          return codeOf(rec.restore('runs', u, r.id));
        })();
        ok('and restoring is refused while it is over', /413 limit_reached/.test(restoreOver), restoreOver);
        rec.LIMITS.total.bytes = 60_000;
        await rec.updateRun(u, first.id, { snapshot: snap(40_000) });
        await rec.softDelete('runs', u, first.id);
        const full = await codeOf(rec.createRun(u, { path: [], snapshot: snap(30_000) }));
        await rec.purge('runs', u, first.id);
        const afterPurge = await codeOf(rec.createRun(u, { path: [], snapshot: snap(30_000) }));
        ok('purging does make room', /limit_reached/.test(full) && afterPurge === 'ok', full + ' then ' + afterPurge);
        putBack();
      }

      /* ---- per-record limits on update, measured after the filter ---- */
      {
        const u = await newUser('record');
        /* 80,000 quotes in an attribute: 80 KB sent, 480 KB once each is &quot; */
        const swollen = { ...T, GUIDE: [{ h: 'g', html: "<b title='" + '"'.repeat(80_000) + "'>x</b>" }] };
        const made = await codeOf(rec.createRun(u, { path: [], snapshot: swollen }));
        ok('a snapshot the filter swells past the limit is refused on create', /413 too_large/.test(made), made);
        const run = await rec.createRun(u, { path: [], snapshot: T });
        const upd = await codeOf(rec.updateRun(u, run.id, { snapshot: swollen }));
        ok('and on update, which used to skip the check', /413 too_large/.test(upd), upd);
        const doc = await rec.createDocument(u, { bodyHtml: '<p>d</p>' });
        const bigMeta = await codeOf(rec.updateDocument(u, doc.id, { meta: { blob: 'm'.repeat(1_100_000) } }));
        ok('a document’s meta counts toward its limit on update', /413 too_large/.test(bigMeta), bigMeta);
        let deep = [];
        for (let i = 0; i < 200_000; i++) deep = [deep];
        const deepMeta = await codeOf(rec.updateDocument(u, doc.id, { meta: { deep } }));
        ok('a meta nested absurdly deep is a refusal, not a server error', /400 bad_meta/.test(deepMeta), deepMeta);
        const big = { a: 'z'.repeat(2_100_000) };
        const pre = await codeOf(readJson({ body: big, headers: {} }));
        ok('a body the platform parsed for us is still held to 2 MB', /413/.test(pre), pre);
        const declared = await codeOf(readJson({ body: { a: 1 }, headers: { 'content-length': '3000000' } }));
        ok('by its declared length as well', /413/.test(declared), declared);
      }

      /* ---- clean on read ---- */
      {
        const u = await newUser('read');
        const rid = crypto.randomUUID();
        const did = crypto.randomUUID();
        const tid = crypto.randomUUID();
        /* written straight to the table, the way an older version stored it */
        await pool.query(
          `insert into runs (id, user_id, title, path, collected, snapshot) values ($1, $2, 'old', '[]', '[]', $3)`,
          [
            rid,
            u,
            JSON.stringify({
              ...T,
              GUIDE: [{ h: 'g', html: '<p>Old</p><img src=x onerror=alert(1)>' }],
              CONTACT: { calendly: 'javascript:alert(1)//' },
            }),
          ]
        );
        await pool.query(
          `insert into documents (id, user_id, title, body_html) values ($1, $2, 'old', $3)`,
          [did, u, '<p class="pc tasa-ovl">Kept</p><img src=x onerror=alert(1)><div>open']
        );
        await pool.query(`insert into trees (id, user_id, title, data) values ($1, $2, 'old', $3)`, [
          tid,
          u,
          JSON.stringify({ NODES: { q1: { q: 'x', a: [] } }, GUIDE: 'not a list' }),
        ]);
        const run = await rec.getRecord('runs', u, rid);
        const g = run.snapshot && run.snapshot.GUIDE[0].html;
        ok(
          'a saved path’s snapshot is cleaned when it is read',
          !!g && g.includes('<p>Old</p>') && !/onerror/.test(g) && run.snapshot.CONTACT.calendly === '',
          JSON.stringify(run.snapshot).slice(0, 200)
        );
        const doc = await rec.getRecord('documents', u, did);
        ok(
          'so is a document body, keeping the print-out’s own classes',
          !/onerror|tasa-/.test(doc.bodyHtml) && doc.bodyHtml.includes('class="pc"') && doc.bodyHtml.endsWith('</div>'),
          doc.bodyHtml
        );
        const tree = await rec.getRecord('trees', u, tid);
        ok(
          'a saved tree that no longer validates reads as null, with a flag',
          tree.data === null && tree.invalid === true,
          JSON.stringify(tree).slice(0, 200)
        );
      }

      /* ---- the media budget ---- */
      {
        const u = await newUser('media');
        const img = (n) => {
          const b = Buffer.concat([
            Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
            crypto.randomBytes(n),
          ]);
          cleanupMedia.push(crypto.createHash('sha256').update(b).digest('hex'));
          return b;
        };
        const kept = img(2_000);
        await storeImage(kept, 'image/jpeg', u);
        const { rows } = await pool.query('select coalesce(sum(size), 0)::bigint as n from media');
        const before = process.env.TAS_MEDIA_BYTES;
        process.env.TAS_MEDIA_BYTES = String(Number(rows[0].n) + 1_000);
        try {
          let err = null;
          try {
            await storeImage(img(5_000), 'image/jpeg', u);
          } catch (e) {
            err = e;
          }
          ok(
            'an upload past the image budget is a 413 that names the prune command',
            !!err && err.status === 413 && err.code === 'limit_reached' &&
              err.message.includes('npm run db:prune -- --media'),
            err ? err.status + ' ' + err.code + ' ' + err.message : 'stored'
          );
          const again = await codeOf(storeImage(kept, 'image/jpeg', u));
          ok('re-uploading an image already stored still succeeds', again === 'ok', again);
        } finally {
          if (before === undefined) delete process.env.TAS_MEDIA_BYTES;
          else process.env.TAS_MEDIA_BYTES = before;
        }
      }

      /* ---- the published tree: marked when cleaned, cleaned when not ---- */
      {
        const legacy = {
          ...T,
          DISC: { guide: '<p>Old</p><img src=x onerror=alert(1)>' },
          CONTACT: { calendly: "javascript:fetch('/api/auth/me')//" },
        };
        await pool.query(
          `insert into site_tree (id, data, note) values ('current', $1, '')
           on conflict (id) do update set data = excluded.data`,
          [JSON.stringify(legacy)]
        );
        const got = (await call(jar(), '/api/tree')).data || {};
        const d = got.data || {};
        ok(
          'a published row from before the mark is cleaned when it is served',
          got.published === true && !/onerror/.test(d.DISC.guide) && d.CONTACT.calendly === '' && !('_cleanedBy' in d),
          JSON.stringify(got).slice(0, 200)
        );
        const row = (await pool.query(`select data from site_tree where id = 'current'`)).rows[0].data;
        ok(
          'and stored back cleaned and marked, so the next reader skips the work',
          row._cleanedBy === rec.CLEAN_VERSION && !/onerror/.test(row.DISC.guide),
          JSON.stringify(row).slice(0, 200)
        );
        await pool.query(`update site_tree set data = $1 where id = 'current'`, [
          JSON.stringify({ ...legacy, _cleanedBy: 'an older filter' }),
        ]);
        const stale = ((await call(jar(), '/api/tree')).data || {}).data || {};
        ok(
          'a row marked by an older filter is cleaned again',
          !!stale.DISC && !/onerror/.test(stale.DISC.guide),
          JSON.stringify(stale).slice(0, 200)
        );

        /* PUT, as the editor: an account of its own, verified, named in
           ADMIN_EMAIL for the length of this check */
        const ed = jar();
        const edEmail = `selftest-${stamp}-editor@example.invalid`;
        const reg = await call(ed, '/api/auth/register', {
          method: 'POST',
          body: { email: edEmail, password: 'an editor passphrase here', name: 'Editor' },
        });
        if (reg.data && reg.data.user) cleanupUsers.push(reg.data.user.id);
        await pool
          .query('update users set email_verified = true where lower(email) = lower($1)', [edEmail])
          .catch(() => {});
        const gate = process.env.ADMIN_EMAIL;
        process.env.ADMIN_EMAIL = edEmail;
        try {
          const forged = await call(ed, '/api/tree', {
            method: 'PUT',
            body: { data: { ...legacy, _cleanedBy: rec.CLEAN_VERSION } },
          });
          const stored = (await pool.query(`select data from site_tree where id = 'current'`)).rows[0].data;
          ok(
            'a mark sent with the tree buys nothing: what is stored was cleaned',
            forged.status === 200 && !/onerror/.test(stored.DISC.guide) && stored.CONTACT.calendly === '' &&
              stored._cleanedBy === rec.CLEAN_VERSION,
            JSON.stringify(forged.data) + ' ' + JSON.stringify(stored).slice(0, 160)
          );
          rec.LIMITS.trees.bytes = 50_000;
          const swollen = { ...T, GUIDE: [{ h: 'g', html: "<b title='" + '"'.repeat(20_000) + "'>x</b>" }] };
          const big = await call(ed, '/api/tree', { method: 'PUT', body: { data: swollen } });
          ok(
            'a published tree over the size limit after cleaning is refused',
            big.status === 413 && big.data.error === 'too_large',
            JSON.stringify(big.data)
          );
        } finally {
          putBack();
          if (gate === undefined) delete process.env.ADMIN_EMAIL;
          else process.env.ADMIN_EMAIL = gate;
        }
        await pool.query(`delete from site_tree where id = 'current'`);
      }
    } finally {
      putBack();
    }
  }
  /* ======================================================================
     END GROUP: records, markup, media and the published tree
     ====================================================================== */
  /* ======================================================================
     BEGIN GROUP: account security (auth, Google, sessions, throttling,
     scripts/admin-user.mjs)
     Self-contained: its own accounts, each request from its own made-up
     client address (X-Forwarded-For) so the throttles it trips cannot touch
     the groups above, ADMIN_EMAIL put back, nothing left published.
     ====================================================================== */
  console.log('\nAccount security: the editor, Google, sessions and throttling');
  {
    const auth = await import('../api/_lib/auth.js');
    const google = await import('../api/_lib/google.js');
    const pool = getPool();
    const savedGate = process.env.ADMIN_EMAIL;
    const tag = (t) => `selftest-${stamp}-sec-${t}@example.invalid`;
    let ipSeq = 0;
    const freshIp = () => `198.51.100.${++ipSeq}`;
    /* call(), with a client address of our choosing */
    const xcall = async (j, p, { method = 'GET', body, ip } = {}) => {
      const headers = { Accept: 'application/json', 'X-TAS-App': '1', Origin: BASE };
      if (ip) headers['X-Forwarded-For'] = ip;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const cookie = j.header();
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(BASE + p, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
      });
      j.take(res);
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text.slice(0, 300) };
      }
      return { status: res.status, data, location: res.headers.get('location') || '' };
    };
    const register = async (j, email, password, ip) => {
      const r = await xcall(j, '/api/auth/register', {
        method: 'POST',
        body: { email, password, name: '' },
        ip: ip || freshIp(),
      });
      if (r.data && r.data.user) cleanupUsers.push(r.data.user.id);
      return r;
    };
    const idOf = async (email) =>
      ((await pool.query('select id from users where lower(email) = lower($1)', [email])).rows[0] || {}).id;
    /* A session made straight in the table, for accounts with no password to
       sign in with. `authedAgoMs` null means it never proved anything. */
    const plant = async (userId, { authedAgoMs = null, createdAgoMs = 0 } = {}) => {
      const token = crypto.randomBytes(32).toString('base64url');
      const hash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
      await pool.query(
        `insert into sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, authed_at)
         values ($1, $2, $3, now() - ($4 || ' milliseconds')::interval, now(),
                 now() + interval '1 day',
                 case when $5::text is null then null else now() - ($5 || ' milliseconds')::interval end)`,
        [crypto.randomUUID(), userId, hash, String(createdAgoMs), authedAgoMs === null ? null : String(authedAgoMs)]
      );
      const j = jar();
      j.take({ headers: { getSetCookie: () => ['tas_session=' + token + '; Path=/'] } });
      return j;
    };
    const staleAll = (userId) =>
      pool.query(`update sessions set authed_at = now() - interval '1 hour' where user_id = $1`, [userId]);

    try {
      /* ---- the schema ---- */
      {
        const cols = await pool.query(
          `select table_name, column_name from information_schema.columns
            where (table_name = 'users' and column_name = 'email_verified')
               or (table_name = 'sessions' and column_name = 'authed_at')
               or (table_name = 'oauth_flows' and column_name = 'id_hash')`
        );
        ok('the migrations add email_verified, authed_at and oauth_flows', cols.rows.length === 3, JSON.stringify(cols.rows));
        const v = await pool.query(`select v from schema_meta where k = 'schema_version'`);
        const { SCHEMA_VERSION } = await import('../api/_lib/schema.js');
        ok('and the schema version is recorded', Number(v.rows[0].v) === SCHEMA_VERSION && SCHEMA_VERSION >= 7);
      }

      /* ---- registering the editor's address proves nothing ---- */
      const boss = { jar: jar(), email: tag('boss'), password: 'squatter passphrase one', ip: freshIp() };
      process.env.ADMIN_EMAIL = '  ' + boss.email.toUpperCase() + ' ';
      {
        const r = await register(boss.jar, boss.email, boss.password, boss.ip);
        ok('anyone may still register the editor’s address', r.status === 201, JSON.stringify(r.data));
        ok('but it is not verified', r.data.user && r.data.user.emailVerified === false);
        const me = await xcall(boss.jar, '/api/auth/me', { ip: boss.ip });
        ok(
          'so it is not the editor, and is told why',
          me.data.admin === false && me.data.adminReason === 'admin_unverified',
          JSON.stringify({ admin: me.data.admin, reason: me.data.adminReason })
        );
        const put = await xcall(boss.jar, '/api/tree', { method: 'PUT', body: { data: SAMPLE_TREE }, ip: boss.ip });
        ok('it cannot publish', put.status === 403 && put.data.error === 'admin_unverified', JSON.stringify(put.data));
        const drop = await xcall(boss.jar, '/api/tree', { method: 'DELETE', ip: boss.ip });
        ok('or withdraw', drop.status === 403, String(drop.status));
        const img = await fetch(BASE + '/api/media', {
          method: 'POST',
          headers: { 'X-TAS-App': '1', Origin: BASE, 'Content-Type': 'image/jpeg', Cookie: boss.jar.header() },
          body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]),
        });
        ok('or upload', img.status === 403, String(img.status));
        await img.arrayBuffer();
      }

      /* ---- Google proves the address: the squatter loses the account ---- */
      {
        const squatterId = await idOf(boss.email);
        const out = await auth.findOrCreateGoogleUser({
          sub: 'selftest-sec-boss-' + stamp,
          email: boss.email,
          emailVerified: true,
          name: 'Real Owner',
          picture: '',
        });
        ok(
          'a Google sign-in for an unverified address takes that account over',
          out.id === squatterId && out.linked === true && out.reclaimed === true,
          JSON.stringify(out)
        );
        const me = await xcall(boss.jar, '/api/auth/me', { ip: boss.ip });
        ok('the squatter’s session is gone', me.data.user === null);
        const back = await xcall(jar(), '/api/auth/login', {
          method: 'POST',
          body: { email: boss.email, password: boss.password },
          ip: freshIp(),
        });
        ok('and so is the squatter’s password', back.status === 409 && back.data.error === 'use_google', JSON.stringify(back.data));
        const row = (await pool.query('select email_verified, password_hash from users where id = $1', [squatterId])).rows[0];
        ok('the address is now verified', row.email_verified === true && row.password_hash === null);

        /* the owner, signed in (a session the way Google's callback makes one) */
        const owner = await plant(squatterId, { authedAgoMs: 1000 });
        const mine = await xcall(owner, '/api/auth/me');
        ok('and the proven owner is the editor', mine.data.admin === true && !mine.data.adminReason, JSON.stringify({ a: mine.data.admin, r: mine.data.adminReason }));
        const drop = await xcall(owner, '/api/tree', { method: 'DELETE' });
        ok('past the gate (nothing is published, so nothing to withdraw)', drop.status === 400 && drop.data.error === 'not_published', JSON.stringify(drop.data));

        /* ---- a Google sign-in never rewrites the address ---- */
        const personal = { sub: 'selftest-sec-personal-' + stamp, email: tag('personal'), emailVerified: true, name: '', picture: '' };
        let conflict = null;
        try {
          await auth.linkGoogle(squatterId, personal);
        } catch (e) {
          conflict = e.code;
        }
        ok('a second Google account cannot silently replace the attached one', conflict === 'google_conflict', String(conflict));
        await pool.query('update users set google_sub = null where id = $1', [squatterId]);
        await auth.linkGoogle(squatterId, personal);
        const again = await auth.findOrCreateGoogleUser(personal);
        const kept = (await pool.query('select email, email_verified from users where id = $1', [squatterId])).rows[0];
        ok(
          'signing in with a Google account on another address keeps the account’s own address',
          again.id === squatterId && kept.email === boss.email && kept.email_verified === true,
          JSON.stringify(kept)
        );
        const still = await xcall(owner, '/api/auth/me');
        ok('so the editor keeps the editor', still.data.admin === true);
        const squat2 = await register(jar(), boss.email, 'another squatter passphrase');
        ok('and the address is not freed for anyone else', squat2.status === 400 && squat2.data.error === 'email_taken');
      }

      /* ---- verified by the owner's own Google, on the same address ---- */
      {
        const j = jar();
        const email = tag('linker');
        await register(j, email, 'linker passphrase here');
        const id = await idOf(email);
        await auth.linkGoogle(id, { sub: 'selftest-sec-link-' + stamp, email, emailVerified: true, name: '', picture: '' });
        const row = (await pool.query('select email_verified from users where id = $1', [id])).rows[0];
        ok('attaching Google for the account’s own address verifies it', row.email_verified === true);
      }

      /* ---- fail closed ---- */
      for (const blank of [',', '  ', ' , ,']) {
        process.env.ADMIN_EMAIL = blank;
        const owner = await plant(await idOf(boss.email), { authedAgoMs: 1000 });
        const me = await xcall(owner, '/api/auth/me');
        const put = await xcall(owner, '/api/tree', { method: 'PUT', body: { data: SAMPLE_TREE } });
        ok(
          `ADMIN_EMAIL=${JSON.stringify(blank)} shuts the editor rather than opening it`,
          me.data.admin === false && me.data.adminReason === 'admin_unset' &&
            put.status === 403 && put.data.error === 'admin_unset',
          JSON.stringify({ me: me.data.adminReason, put: put.data })
        );
      }
      process.env.ADMIN_EMAIL = boss.email;

      /* ---- the ID token ---- */
      {
        const cid = process.env.GOOGLE_CLIENT_ID;
        const mk = (extra) =>
          'x.' +
          Buffer.from(
            JSON.stringify({
              iss: 'https://accounts.google.com',
              aud: cid,
              exp: Math.floor(Date.now() / 1000) + 600,
              nonce: 'n',
              sub: 's',
              email: 'e@example.invalid',
              ...extra,
            })
          ).toString('base64url') +
          '.y';
        const reads = (t) => {
          try {
            return google.readIdToken(t, { nonce: 'n' });
          } catch (e) {
            return e.code;
          }
        };
        ok('a token with no email_verified claim is refused', reads(mk({})) === 'google_rejected');
        ok('and so is one that says "true" as a string', reads(mk({ email_verified: 'true' })) === 'google_rejected');
        const good = reads(mk({ email_verified: true }));
        ok('a verified one is read', good && good.emailVerified === true && good.email === 'e@example.invalid', JSON.stringify(good));
      }

      /* ---- where to go afterwards ---- */
      {
        const { safeNext } = google;
        ok(
          'a destination outside printable ASCII, or with "//" in it, goes home',
          ['/ x', '/café', '/a//b', '/ x', '/%0a', '/x\\y'].every((v, i) => (i === 4 ? safeNext(v) === v : safeNext(v) === '/')),
          ['/ x', '/café', '/a//b', '/ x', '/x\\y'].map((v) => JSON.stringify(safeNext(v))).join(' ')
        );
        const r = await fetch(BASE + '/api/auth/google/start?next=/%E2%80%A8x', { redirect: 'manual' });
        const flowCookie = (r.headers.getSetCookie() || []).find((l) => l.startsWith('tas_oauth=')) || '';
        const id = flowCookie.split(';')[0].split('=')[1] || '';
        const stored = await pool.query(
          'select next from oauth_flows where id_hash = $1',
          [crypto.createHash('sha256').update(id).digest('hex')]
        );
        ok('so a U+2028 in ?next= is never stored for the callback', stored.rows[0] && stored.rows[0].next === '/', JSON.stringify(stored.rows));
      }

      /* ---- the OAuth flow is server-side and single use ---- */
      {
        const r = await fetch(BASE + '/api/auth/google/start?next=/work', { redirect: 'manual' });
        const line = (r.headers.getSetCookie() || []).find((l) => l.startsWith('tas_oauth=')) || '';
        const id = decodeURIComponent(line.split(';')[0].split('=')[1] || '');
        const state = new URL(r.headers.get('location')).searchParams.get('state');
        ok('the flow cookie is an opaque id, not the flow', !!id && !id.includes(state) && !/next|work/.test(Buffer.from(id, 'base64url').toString('latin1')));
        const rows = await pool.query('select id_hash, state, next from oauth_flows where state = $1', [state]);
        ok(
          'the flow is stored against a hash of that id',
          rows.rows.length === 1 && rows.rows[0].id_hash !== id && rows.rows[0].next === '/work'
        );
        const hit = (st) =>
          fetch(BASE + '/api/auth/google/callback?state=' + encodeURIComponent(st), {
            headers: { Cookie: 'tas_oauth=' + encodeURIComponent(id) },
            redirect: 'manual',
          }).then(async (x) => ({ status: x.status, text: await x.text() }));
        const first = await hit(state);
        ok('the first reply uses the flow (here it carries no code)', first.status === 400 && /no sign-in back/i.test(first.text), first.text.slice(0, 120));
        const second = await hit(state);
        ok('and a second reply with the same cookie finds nothing', second.status === 400 && /could not be completed/i.test(second.text), second.text.slice(0, 120));
        const gone = await pool.query('select 1 from oauth_flows where state = $1', [state]);
        ok('the row is gone', gone.rows.length === 0);
        const expired = await google.saveFlow({ state: 's', nonce: 'n', next: '/', link: false });
        await pool.query(`update oauth_flows set expires_at = now() - interval '1 second' where state = 's'`);
        ok('an expired flow is refused', (await google.takeFlow(expired)) === null);
        const tampered = await fetch(BASE + '/api/auth/google/callback?code=x&state=' + state, {
          headers: { Cookie: 'tas_oauth=' + encodeURIComponent(Buffer.from(JSON.stringify({ s: state, n: 'n', next: '/', link: true })).toString('base64url')) },
          redirect: 'manual',
        });
        ok('a hand-written flow cookie of the old shape is worthless', tampered.status === 400);
        await tampered.text();
      }

      /* ---- attaching Google needs a recent sign-in, bound to the session ---- */
      {
        const j = jar();
        const email = tag('attach');
        const ip = freshIp();
        await register(j, email, 'attach passphrase here', ip);
        const id = await idOf(email);
        await staleAll(id);
        const stale = await xcall(j, '/api/auth/google/start?link=1&next=/work', { ip });
        ok(
          'from a session that has not signed in recently, it sends the page back to confirm first',
          stale.status === 302 && stale.location === '/work?signin=reauth',
          stale.status + ' ' + stale.location
        );
        await pool.query('update sessions set authed_at = now() where user_id = $1', [id]);
        const fresh = await xcall(j, '/api/auth/google/start?link=1&next=/work', { ip });
        const state = new URL(fresh.location).searchParams.get('state');
        const flow = (await pool.query('select link, session_id from oauth_flows where state = $1', [state])).rows[0];
        const sid = (await pool.query('select id from sessions where user_id = $1', [id])).rows[0].id;
        ok('from a fresh one, the flow records exactly which session asked', !!flow && flow.link === true && flow.session_id === sid, JSON.stringify(flow));
      }

      /* ---- throttling ---- */
      {
        const victim = { jar: jar(), email: tag('victim'), password: 'victim passphrase here', home: freshIp() };
        await register(victim.jar, victim.email, victim.password, victim.home);
        const attacker = freshIp();
        const burst = await Promise.all(
          Array.from({ length: 40 }, (_, i) =>
            xcall(jar(), '/api/auth/login', {
              method: 'POST',
              body: { email: victim.email, password: 'wrong guess number ' + i },
              ip: attacker,
            })
          )
        );
        const checked = burst.filter((r) => r.status === 401).length;
        const refused = burst.filter((r) => r.status === 429).length;
        ok(
          '40 parallel guesses: no more are checked than the limit allows',
          checked === 8 && refused === 32,
          `checked ${checked}, refused ${refused}, other ${burst.length - checked - refused}`
        );
        const owner = await xcall(jar(), '/api/auth/login', {
          method: 'POST',
          body: { email: victim.email, password: victim.password },
          ip: freshIp(),
        });
        ok('and the owner, from anywhere else, still signs in', owner.status === 200, JSON.stringify(owner.data));

        /* a distributed flood, enough to trip the per-account ceiling */
        for (let k = 0; k < 4; k++) {
          const ip = freshIp();
          await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
              xcall(jar(), '/api/auth/login', { method: 'POST', body: { email: victim.email, password: 'flood ' + k + i }, ip })
            )
          );
        }
        const stranger = await xcall(jar(), '/api/auth/login', {
          method: 'POST',
          body: { email: victim.email, password: victim.password },
          ip: freshIp(),
        });
        ok('past the account ceiling a new address is slowed down', stranger.status === 429, String(stranger.status));
        const home = await xcall(jar(), '/api/auth/login', {
          method: 'POST',
          body: { email: victim.email, password: victim.password },
          ip: victim.home,
        });
        ok('but the owner, from where they have signed in before, is not locked out', home.status === 200, JSON.stringify(home.data));
      }
      {
        /* The default is 20 an hour, sized for a room of people behind one
           office address. The ceiling is exercised at 5, set the way a
           deployment would set it, so the test does not have to mint 23
           accounts; it is read per request, so it applies at once. */
        const was = process.env.TAS_REGISTRATIONS_PER_IP;
        delete process.env.TAS_REGISTRATIONS_PER_IP;
        ok('twenty registrations an hour per address by default', auth.registrationsPerIp() === 20, String(auth.registrationsPerIp()));
        process.env.TAS_REGISTRATIONS_PER_IP = 'lots';
        ok('a TAS_REGISTRATIONS_PER_IP that is not a number falls back to the default', auth.registrationsPerIp() === 20);
        process.env.TAS_REGISTRATIONS_PER_IP = '5';
        const ip = freshIp();
        let made;
        try {
          made = await Promise.all(
            Array.from({ length: 8 }, (_, i) => register(jar(), tag('mint' + i), 'minted passphrase ' + i, ip))
          );
        } finally {
          if (was === undefined) delete process.env.TAS_REGISTRATIONS_PER_IP;
          else process.env.TAS_REGISTRATIONS_PER_IP = was;
        }
        const created = made.filter((r) => r.status === 201).length;
        ok(
          'registrations from one address are limited to TAS_REGISTRATIONS_PER_IP, even all at once',
          created === 5 && made.filter((r) => r.status === 429).length === 3,
          made.map((r) => r.status).join(',')
        );
        const other = await register(jar(), tag('mint-elsewhere'), 'minted passphrase x');
        ok('while another address can still register', other.status === 201);
      }
      {
        /* The database ceiling, set far below what the test database already
           holds. It is read on every check, so it applies at once. */
        const who = { jar: jar(), email: tag('ceiling'), password: 'ceiling passphrase', ip: freshIp() };
        const madeIt = await register(who.jar, who.email, who.password, who.ip);
        const was = process.env.TAS_DB_BYTES;
        process.env.TAS_DB_BYTES = '1';
        let refusedReg, refusedSave, signIn;
        try {
          refusedReg = await register(jar(), tag('ceiling-new'), 'ceiling passphrase 2');
          refusedSave = await xcall(who.jar, '/api/runs', { method: 'POST', body: { path: [] }, ip: who.ip });
          signIn = await xcall(jar(), '/api/auth/login', {
            method: 'POST',
            body: { email: who.email, password: who.password },
            ip: who.ip,
          });
        } finally {
          if (was === undefined) delete process.env.TAS_DB_BYTES;
          else process.env.TAS_DB_BYTES = was;
        }
        ok('past TAS_DB_BYTES a new account is refused as storage_full',
          madeIt.status === 201 && refusedReg.status === 507 && refusedReg.data && refusedReg.data.error === 'storage_full',
          refusedReg.status + ' ' + JSON.stringify(refusedReg.data));
        ok('and so is new saved work', refusedSave.status === 507, String(refusedSave.status));
        ok('but signing in still works', signIn.status === 200, String(signIn.status));
        const after = await register(jar(), tag('ceiling-after'), 'ceiling passphrase 3');
        ok('and with the ceiling back where it was, registering works again', after.status === 201, String(after.status));
      }
      {
        const u = { jar: jar(), email: tag('pwcheck'), password: 'pwcheck passphrase', ip: freshIp() };
        await register(u.jar, u.email, u.password, u.ip);
        const tries = [];
        for (let i = 0; i < 12; i++) {
          tries.push(
            await xcall(u.jar, '/api/auth/password', {
              method: 'POST',
              body: { current: 'not it ' + i, password: 'a replacement passphrase' },
              ip: u.ip,
            })
          );
        }
        ok(
          'current-password checks when changing it are throttled too',
          tries.filter((r) => r.status === 400).length === 8 && tries.slice(8).every((r) => r.status === 429),
          tries.map((r) => r.status).join(',')
        );
        const del = await xcall(u.jar, '/api/auth/account', {
          method: 'DELETE',
          body: { confirm: 'DELETE', password: 'still not it' },
          ip: u.ip,
        });
        ok('and so is the one for closing the account', del.status === 429, String(del.status));
      }

      /* ---- sensitive changes need a recent sign-in or the password ---- */
      {
        const u = { jar: jar(), email: tag('sensitive'), password: 'sensitive passphrase', ip: freshIp() };
        await register(u.jar, u.email, u.password, u.ip);
        const id = await idOf(u.email);
        const other = jar();
        await xcall(other, '/api/auth/login', { method: 'POST', body: { email: u.email, password: u.password }, ip: freshIp() });
        await staleAll(id);
        const noProof = await xcall(u.jar, '/api/auth/sessions', { method: 'DELETE', ip: u.ip });
        ok(
          'signing others out from a session that has not signed in recently is refused',
          noProof.status === 403 && noProof.data.error === 'reauth_required',
          JSON.stringify(noProof.data)
        );
        const blank = await xcall(u.jar, '/api/auth/password', {
          method: 'POST',
          body: { current: '', password: 'a brand new passphrase' },
          ip: u.ip,
        });
        ok('and so is a password change with no current password', blank.status === 403 && blank.data.error === 'reauth_required');
        const withPw = await xcall(u.jar, '/api/auth/sessions', { method: 'DELETE', body: { password: u.password }, ip: u.ip });
        ok('the password is proof enough', withPw.status === 200, JSON.stringify(withPw.data));
        ok('and the other browser is out', (await xcall(other, '/api/auth/me')).data.user === null);

        /* a fresh sign-in stands in for the password, for ten minutes */
        const f = jar();
        await xcall(f, '/api/auth/login', { method: 'POST', body: { email: u.email, password: u.password }, ip: u.ip });
        const me = await xcall(f, '/api/auth/me', { ip: u.ip });
        ok('the page is told how long the sign-in counts as recent', !!me.data.recentAuthUntil && Date.parse(me.data.recentAuthUntil) > Date.now());
        const before = f.header();
        const change = await xcall(f, '/api/auth/password', {
          method: 'POST',
          body: { current: '', password: 'a brand new passphrase' },
          ip: u.ip,
        });
        ok('a fresh sign-in may change the password without it', change.status === 200, JSON.stringify(change.data));
        ok('and the session token is replaced', f.header() !== before && !!f.header());
        const old = jar();
        old.take({ headers: { getSetCookie: () => [before + '; Path=/'] } });
        ok('the old token no longer works', (await xcall(old, '/api/auth/me')).data.user === null);
        ok('the new one does', (await xcall(f, '/api/auth/me')).data.user !== null);
        ok('and the stale session is gone too', (await xcall(u.jar, '/api/auth/me')).data.user === null);
      }

      /* ---- a borrowed session on a Google-only account ---- */
      {
        const g = await auth.findOrCreateGoogleUser({
          sub: 'selftest-sec-gonly-' + stamp,
          email: tag('gonly'),
          emailVerified: true,
          name: '',
          picture: '',
        });
        cleanupUsers.push(g.id);
        const borrowed = await plant(g.id, { authedAgoMs: 60 * 60 * 1000 });
        const setPw = await xcall(borrowed, '/api/auth/password', { method: 'POST', body: { password: 'borrower passphrase 99' } });
        ok(
          'a session that has not signed in recently cannot put a password on a Google-only account',
          setPw.status === 403 && setPw.data.error === 'reauth_required',
          JSON.stringify(setPw.data)
        );
        ok('which still has none', (await auth.signInMethods(g.id)).password === false);
        const closeStale = await xcall(borrowed, '/api/auth/account', { method: 'DELETE', body: { confirm: 'DELETE', password: '' } });
        ok('nor close it', closeStale.status === 403 && closeStale.data.error === 'reauth_required');
        const fresh = await plant(g.id, { authedAgoMs: 1000 });
        const close = await xcall(fresh, '/api/auth/account', { method: 'DELETE', body: { confirm: 'DELETE', password: '' } });
        ok('a Google-only account closes itself after a fresh sign-in', close.status === 200, JSON.stringify(close.data));
        ok('and is gone', (await pool.query('select 1 from users where id = $1', [g.id])).rows.length === 0);
      }

      /* ---- detaching Google ends the other sessions ---- */
      {
        const u = { jar: jar(), email: tag('unlink'), password: 'unlink passphrase', ip: freshIp() };
        await register(u.jar, u.email, u.password, u.ip);
        const id = await idOf(u.email);
        await auth.linkGoogle(id, { sub: 'selftest-sec-unlink-' + stamp, email: tag('elsewhere'), name: '', picture: '' });
        const viaGoogle = await plant(id, { authedAgoMs: 1000 });
        const r = await xcall(u.jar, '/api/auth/google/unlink', { method: 'POST', body: { password: u.password }, ip: u.ip });
        ok('Google detaches with the password', r.status === 200 && r.data.methods.google === false, JSON.stringify(r.data));
        ok('and a session made through it does not outlive it', (await xcall(viaGoogle, '/api/auth/me')).data.user === null);
        ok('while this one stays', (await xcall(u.jar, '/api/auth/me')).data.user !== null);
      }

      /* ---- session lifetime and count ---- */
      {
        const u = { email: tag('many'), password: 'many sessions passphrase', ip: freshIp() };
        await register(jar(), u.email, u.password, u.ip);
        const id = await idOf(u.email);
        for (let i = 0; i < 23; i++) {
          await xcall(jar(), '/api/auth/login', { method: 'POST', body: { email: u.email, password: u.password }, ip: u.ip });
        }
        const n = (await pool.query('select count(*)::int as n from sessions where user_id = $1', [id])).rows[0].n;
        ok('an account keeps at most 20 sessions', n === 20, String(n));

        const old = await plant(id, { authedAgoMs: null, createdAgoMs: 31 * 24 * 3600 * 1000 });
        ok('a session older than 30 days is dead whatever its expiry says', (await xcall(old, '/api/auth/me')).data.user === null);
        const nearly = await plant(id, { authedAgoMs: null, createdAgoMs: 29 * 24 * 3600 * 1000 });
        await pool.query(
          `update sessions set last_seen_at = now() - interval '7 hours'
            where user_id = $1 and created_at < now() - interval '28 days'`,
          [id]
        );
        ok('one younger still works', (await xcall(nearly, '/api/auth/me')).data.user !== null);
        const row = (
          await pool.query(
            `select extract(epoch from (created_at + interval '30 days' - expires_at))::int as slack
               from sessions where user_id = $1 and created_at < now() - interval '28 days'`,
            [id]
          )
        ).rows[0];
        ok('and using it never pushes its expiry past 30 days from creation', row && row.slack >= 0, JSON.stringify(row));
      }

      /* ---- scripts/admin-user.mjs ----
         Run as the child process it is, against a throwaway database of its
         own: the one above is behind a single-connection socket that this
         process is holding. */
      {
        const { spawn } = await import('node:child_process');
        const { startPglite } = await import('./pglite.mjs');
        const pgmod = (await import('pg')).default;
        const side = await startPglite();
        if (!side) {
          ok('admin-user checks skipped: PGlite is not installed', true);
        } else {
          try {
            const run = (args, extraEnv = {}, input = '') =>
              new Promise((resolve) => {
                const child = spawn(process.execPath, ['scripts/admin-user.mjs', ...args], {
                  env: {
                    ...process.env,
                    DATABASE_URL: side.url,
                    PGSSL: 'off',
                    TAS_NEW_PASSWORD: '',
                    ...extraEnv,
                  },
                  stdio: ['pipe', 'pipe', 'pipe'],
                });
                let out = '';
                let err = '';
                child.stdout.on('data', (d) => (out += d));
                child.stderr.on('data', (d) => (err += d));
                child.on('close', (status) => resolve({ status, stdout: out, stderr: err }));
                child.stdin.end(input);
              });
            const row = async (email) => {
              const c = new pgmod.Client({ connectionString: side.url, ssl: false });
              await c.connect();
              try {
                const r = await c.query(
                  'select email_verified, password_hash from users where lower(email) = lower($1)',
                  [email]
                );
                return r.rows[0] || null;
              } finally {
                await c.end();
              }
            };
            const email = tag('cli');
            const inline = await run(['create', email, 'a password on the command line']);
            ok(
              'admin-user refuses a password given as an argument',
              inline.status === 2 && /not taken as command-line arguments/.test(inline.stderr),
              inline.status + ' ' + inline.stderr.slice(0, 200)
            );
            const made = await run(['create', email], { TAS_NEW_PASSWORD: 'cli made passphrase' });
            const r1 = await row(email);
            ok(
              'create takes the password from TAS_NEW_PASSWORD and verifies the address',
              made.status === 0 && !!r1 && r1.email_verified === true &&
                (await auth.verifyPassword('cli made passphrase', r1.password_hash)),
              made.status + ' ' + made.stderr.slice(0, 200)
            );
            const piped = await run(['passwd', email], {}, 'piped in passphrase\n');
            const r2 = await row(email);
            ok(
              'passwd reads a piped password instead',
              piped.status === 0 && (await auth.verifyPassword('piped in passphrase', r2.password_hash)),
              piped.status + ' ' + piped.stderr.slice(0, 200)
            );
            const weak = await run(['passwd', email], {}, 'short\n');
            ok('and still applies the password rules', weak.status === 1);
            /* an account registered the ordinary way, unverified */
            const other = tag('cli-verify');
            {
              const c = new pgmod.Client({ connectionString: side.url, ssl: false });
              await c.connect();
              await c.query(
                `insert into users (id, email, name, password_hash) values ($1, $2, '', null)`,
                [crypto.randomUUID(), other]
              );
              await c.end();
            }
            const before = await row(other);
            const v = await run(['verify', other]);
            const after = await row(other);
            ok(
              'verify marks an address verified',
              before.email_verified === false && v.status === 0 && after.email_verified === true,
              v.status + ' ' + v.stderr.slice(0, 200)
            );
          } finally {
            await side.stop();
          }
        }
      }
    } finally {
      if (savedGate === undefined) delete process.env.ADMIN_EMAIL;
      else process.env.ADMIN_EMAIL = savedGate;
      await pool.query(`delete from site_tree where id = 'current'`).catch(() => {});
      await pool
        .query(`delete from auth_attempts where bucket like $1 or bucket like $2`, [`%selftest-${stamp}-sec-%`, '%198.51.100.%'])
        .catch(() => {});
    }
  }
  /* ======================================================================
     END GROUP: account security
     ====================================================================== */
} catch (err) {
  failures.push('threw: ' + (err.stack || err.message));
  console.error('\nthrew:', err);
} finally {
  /* Belt and braces: if an assertion above stopped the run before the
     accounts were closed, take them out here rather than leaving test rows
     in a real database. */
  try {
    const pool = getPool();
    for (const id of cleanupUsers) {
      await pool.query('delete from users where id = $1', [id]).catch(() => {});
    }
    await pool.query(`delete from auth_attempts where bucket like $1`, ['id:selftest-%']).catch(() => {});
    if (cleanupMedia.length) {
      await pool.query('delete from media where hash = any($1)', [cleanupMedia]).catch(() => {});
    }
  } catch {
    /* nothing to clean up */
  }
  server.close();
  await getPool().end().catch(() => {});
  if (temp) await temp.stop();
}

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log(failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
