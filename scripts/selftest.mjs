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

try {
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
    /* linking on a verified address joins rather than duplicating */
    const { findOrCreateGoogleUser } = await import('../api/_lib/auth.js');
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
    ok('and everyone signed in may edit', me.data.admin === true);
  }
  {
    process.env.ADMIN_EMAIL = A.email;
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
    ok('a signed-in account publishes when there is no gate', r.status === 200, JSON.stringify(r.data));
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
