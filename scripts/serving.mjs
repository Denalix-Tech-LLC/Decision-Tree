/* ===========================================================================
   WHAT GETS SERVED, TO WHOM, AND OVER WHAT

     node scripts/serving.mjs        (part of npm run selftest)

   Four things that are invisible from inside the app and each went wrong:

     1. The Content-Security-Policy rules in vercel.json — every path gets
        exactly one policy, and each page gets its own hashes.
     2. .vercelignore — a manual `npx vercel --prod` uploaded .pglite/, the
        local database with real account emails and password hashes, and
        served it as static files.
     3. The dev server — it served every file under the repo (.env, .git,
        .pglite) to any Host header, so a DNS-rebinding page could read it.
     4. Database TLS — an explicit sslmode=verify-full was stripped from the
        URL and certificate verification stayed off without a word.

   No network and no database: the dev server is started on a free port and
   only its static side and its Host check are exercised.
   ========================================================================= */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const ROOT = process.cwd();

const csp = await import('./csp.mjs');

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

/* ---- 1. the policy -------------------------------------------------------- */
console.log('\nContent-Security-Policy: one policy per path, the right one per page');
{
  /* the browser hashes script text after turning CRLF into LF */
  const lf = csp.inlineScripts('<script>a();\nb();</script><script src="x.js"></script>');
  const crlf = csp.inlineScripts('<SCRIPT type="text/javascript">a();\r\nb();</script >');
  ok('an inline block is found and a src= block is not', lf.length === 1, JSON.stringify(lf));
  ok('CRLF hashes the same as LF', crlf.length === 1 && csp.hashOf(crlf[0]) === csp.hashOf(lf[0]));

  const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const policies = (p) =>
    config.headers
      .filter((r) => csp.sourceToRegex(r.source).test(p))
      .flatMap((r) => r.headers)
      .filter((h) => h.key === 'Content-Security-Policy')
      .map((h) => h.value);

  const pageOf = {};
  for (const page of csp.PAGES) for (const s of page.sources) pageOf[s] = page;
  for (const p of Object.keys(pageOf)) {
    const got = policies(p);
    const html = fs.readFileSync(pageOf[p].file, 'utf8');
    const hashes = csp.inlineScripts(html).map(csp.hashOf);
    ok(
      p + ' has one policy, carrying ' + pageOf[p].file + '’s ' + hashes.length + ' hash(es)',
      got.length === 1 && hashes.every((h) => got[0].includes(h)) && got[0].includes("frame-ancestors 'none'"),
      JSON.stringify(got).slice(0, 200)
    );
  }
  ok(
    'only the reader may frame Calendly',
    policies('/')[0].includes('https://calendly.com') && policies('/admin')[0].includes("frame-src 'none'")
  );

  for (const p of ['/account.js', '/theme.css', '/land.jpg', '/api/tree', '/api/auth/me', '/nope',
    '/administrator', '/admin/x', '/work.htmlx', '/index.html.bak']) {
    const got = policies(p);
    ok(p + ' gets the no-script fallback, once', got.length === 1 && got[0] === csp.FALLBACK_POLICY, JSON.stringify(got));
  }
  ok(
    '/api/media/* is left to the handler’s own sandbox policy',
    policies('/api/media/' + 'a'.repeat(64)).length === 0
  );

  const all = (p) => new Map(csp.headersFor(config, p).map(([k, v]) => [k.toLowerCase(), v]));
  for (const p of ['/', '/admin', '/work', '/api/tree', '/api/media/' + 'a'.repeat(64), '/look.js']) {
    const h = all(p);
    ok(
      p + ' is not frameable, isolates its opener, and pins HTTPS',
      h.get('x-frame-options') === 'DENY' &&
        h.get('cross-origin-opener-policy') === 'same-origin' &&
        /max-age=63072000; includeSubDomains/.test(h.get('strict-transport-security') || '') &&
        h.get('x-content-type-options') === 'nosniff'
    );
  }
  const media = all('/api/media/' + 'a'.repeat(64));
  ok(
    '/api/media/* keeps its exemption from the no-store rule',
    !media.has('cache-control') && media.get('x-robots-tag') === 'noindex'
  );
  ok('the rest of /api is still no-store', /no-store/.test(all('/api/tree').get('cache-control') || ''));

  /* a stale hash is caught — in a scratch copy, never the real pages */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tas-csp-'));
  try {
    for (const f of ['index.html', 'admin.html', 'work.html']) fs.copyFileSync(f, path.join(tmp, f));
    fs.writeFileSync(path.join(tmp, 'vercel.json'), JSON.stringify(csp.withCsp(config, csp.cspRules(tmp))));
    ok('a freshly generated vercel.json has no problems', csp.cspProblems(tmp).length === 0);
    const idx = path.join(tmp, 'index.html');
    fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace(/<script>/, '<script>void 0;'));
    const probs = csp.cspProblems(tmp);
    ok('one changed character in an inline script is reported', probs.some((p) => /for \/ does not match/.test(p)), probs.join('; '));
    fs.writeFileSync(path.join(tmp, 'about.html'), '<script>x()</script>');
    ok('a page with no entry is reported', csp.cspProblems(tmp).some((p) => /about\.html/.test(p)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ---- 2. what a deployment uploads ----------------------------------------- */
console.log('\n.vercelignore: the site goes up, nothing local does');
{
  const rules = csp.readIgnore(ROOT);
  const up = (rel, dir) => csp.deployable(rules, rel, dir);
  for (const f of ['index.html', 'admin.html', 'work.html', 'account.js', 'tree-data.js', 'look.js',
    'view.js', 'theme.css', 'land.jpg', 'api/index.js', 'api/[...route].js', 'api/_lib/db.js',
    'api/_routes/media/[hash].js', 'package.json', 'package-lock.json', 'vercel.json']) {
    ok('uploads ' + f, up(f, false));
  }
  for (const [f, dir] of [['.pglite', true], ['.pglite/base/5/16395', false], ['.env', false],
    ['.env.example', false], ['.env.production', false], ['.git/config', false], ['.github', true],
    ['.claude', true], ['.vercel', true], ['node_modules/pg/package.json', false], ['scripts', true],
    ['scripts/env.mjs', false], ['scripts/responsive.js', false], ['docs', true], ['dev-server.mjs', false],
    ['README.md', false], ['decision-tree-prompt.md', false], ['ESE TAS tool decision tree.docx', false],
    ['npm-debug.log', false], ['sh.exe.stackdump', false], ['api/.env', false]]) {
    ok('leaves out ' + f, !up(f, dir));
  }

  /* the parser itself, on the gitignore rules that matter */
  const r = csp.parseIgnore('/*\n!/*.js\n!/api\nbuild/\n\\#hash\n# comment\n*.log\n!keep.log');
  ok('a root glob allows a root file back in', csp.deployable(r, 'a.js') && !csp.deployable(r, 'a.mjs'));
  ok('nothing inside an ignored directory comes back', !csp.deployable(r, 'scripts/a.js'));
  ok('a re-included directory brings its contents', csp.deployable(r, 'api/x/y.js'));
  ok('a trailing slash is directories only', csp.isIgnored(r, 'api/build', true) && !csp.isIgnored(r, 'api/build', false));
  ok('later lines win', !csp.isIgnored(r, 'api/keep.log') && csp.isIgnored(r, 'api/other.log'));
  ok('an escaped # is a pattern, a bare one a comment', csp.isIgnored(r, 'api/#hash') && r.length === 7);
}

/* ---- 3. the dev server ---------------------------------------------------- */
console.log('\ndev server: localhost only, production’s headers, production’s files');
{
  process.env.TAS_QUIET = '1';
  const { startServer } = await import('../dev-server.mjs');
  const server = await startServer(0);
  const port = server.address().port;
  const get = (p, host, method = 'GET', headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: p, method, headers: { Host: host || '127.0.0.1:' + port, ...headers } },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res));
        }
      );
      req.on('error', reject);
      req.end();
    });

  try {
    ok('it listens on the loopback address only', server.address().address === '127.0.0.1', server.address().address);

    const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
    const want = (p) => new Map(csp.headersFor(config, p).map(([k, v]) => [k.toLowerCase(), v]));
    for (const p of ['/', '/admin', '/work']) {
      const res = await get(p);
      ok(
        p + ' is served with vercel.json’s policy and framing headers',
        res.statusCode === 200 &&
          res.headers['content-security-policy'] === want(p).get('content-security-policy') &&
          res.headers['x-frame-options'] === 'DENY' &&
          res.headers['cross-origin-opener-policy'] === 'same-origin',
        res.statusCode + ' ' + res.headers['content-security-policy']
      );
    }
    const js = await get('/account.js');
    ok('a script is served, under the no-script fallback', js.statusCode === 200 &&
      js.headers['content-security-policy'] === csp.FALLBACK_POLICY);
    ok('the photograph is served', (await get('/land.jpg')).statusCode === 200);

    for (const host of ['localhost:' + port, '[::1]:' + port]) {
      ok('Host ' + host + ' is answered', (await get('/', host)).statusCode === 200);
    }
    for (const host of ['attacker.example:' + port, 'localhost:' + (port === 1 ? 2 : 1), 'localhost', '127.0.0.1.attacker.example:' + port]) {
      ok('Host ' + host + ' is refused', (await get('/', host)).statusCode === 421);
    }
    const rebound = await get('/api/auth/logout', 'attacker.example:' + port, 'POST', {
      Origin: 'http://attacker.example:' + port,
      'X-TAS-App': '1',
    });
    ok('a rebinding page cannot write through the API', rebound.statusCode === 421, String(rebound.statusCode));

    /* only paths that really exist here prove anything, so those are the ones asked for */
    const secret = ['/.git/config', '/.git/HEAD', '/.env', '/.env.example', '/.pglite/PG_VERSION',
      '/.gitignore', '/.vercelignore', '/node_modules/pg/package.json', '/scripts/env.mjs',
      '/scripts/responsive.js', '/dev-server.mjs', '/README.md', '/docs', '/.github/workflows/deploy.yml'];
    for (const p of secret.filter((p) => fs.existsSync(path.join(ROOT, p)))) {
      const res = await get(p);
      ok(p + ' exists here and is not served', res.statusCode === 404, String(res.statusCode));
    }
    for (const p of ['/%2eenv', '/%2Egit/config', '/x/../.git/config', '/scripts/../.git/HEAD', '/.git%2fconfig']) {
      const res = await get(p);
      ok(p + ' does not reach a hidden file', res.statusCode === 404 || res.statusCode === 400, String(res.statusCode));
    }
    for (const p of ['/..%2f..%2f..%2fetc%2fpasswd', '/%E0%A4%A', '/C:%5cWindows%5cwin.ini']) {
      const res = await get(p);
      ok(p + ' is refused', res.statusCode === 400 || res.statusCode === 404, String(res.statusCode));
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
}

/* ---- 4. database TLS ------------------------------------------------------ */
console.log('\nTLS: asking for verification always gets it; the default is unchanged');
{
  const { sslFor, withoutSslMode } = await import('../api/_lib/db.js');
  const ConnectionParameters = (await import('pg/lib/connection-parameters.js')).default;
  const saved = {};
  const KEYS = ['PGSSL', 'PGSSLMODE', 'PGSSLROOTCERT'];
  for (const k of KEYS) saved[k] = process.env[k];
  const env = (o) => {
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, o);
  };
  const warn = console.warn;
  console.warn = () => {};
  const NEON = 'postgres://u:p@ep-x-pooler.us-east-2.aws.neon.tech/db';
  const verifies = (s) => !!s && s.rejectUnauthorized === true;
  try {
    env({});
    const def = sslFor(NEON + '?sslmode=require');
    ok('sslmode=require: encrypted, unverified — the default, unchanged', def && def.rejectUnauthorized === false);
    ok('no sslmode: the same default', sslFor(NEON).rejectUnauthorized === false);
    ok('localhost: no TLS, unchanged', sslFor('postgres://u:p@localhost:5432/db') === false);
    ok('sslmode=disable: no TLS, unchanged', sslFor(NEON + '?sslmode=disable') === false);
    env({ PGSSL: 'off' });
    ok('PGSSL=off: no TLS, unchanged', sslFor(NEON + '?sslmode=require') === false);

    env({});
    const full = sslFor(NEON + '?sslmode=verify-full');
    ok('sslmode=verify-full in the URL verifies chain and host name', verifies(full) && !full.checkServerIdentity, JSON.stringify(full));
    const ca = sslFor(NEON + '?application_name=x&SSLMODE=verify-ca');
    ok('sslmode=verify-ca in the URL verifies the chain only', verifies(ca) && typeof ca.checkServerIdentity === 'function');
    env({ PGSSLMODE: 'verify-full' });
    ok('PGSSLMODE=verify-full wins over the URL’s sslmode=require', verifies(sslFor(NEON + '?sslmode=require')));
    env({ PGSSL: 'off' });
    ok('verify-full wins over PGSSL=off, never the other way', verifies(sslFor(NEON + '?sslmode=verify-full')));
    env({});
    ok('verify-full holds on localhost too', verifies(sslFor('postgres://u:p@127.0.0.1:5432/db?sslmode=verify-full')));

    const PEM = '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----';
    env({ PGSSLROOTCERT: PEM });
    const own = sslFor(NEON + '?sslmode=require');
    ok('PGSSLROOTCERT as PEM text is the CA, and verifies (as libpq does)', verifies(own) && /\nMIIB\n/.test(own.ca || ''));
    env({ PGSSLROOTCERT: path.join(os.tmpdir(), 'tas-no-such-ca-' + process.pid + '.pem') });
    let threw = false;
    try {
      sslFor(NEON);
    } catch {
      threw = true;
    }
    ok('an unreadable PGSSLROOTCERT is an error, not verification quietly off', threw);
    env({ PGSSLROOTCERT: 'system' });
    ok('PGSSLROOTCERT=system uses Node’s CAs and verifies', verifies(sslFor(NEON)) && !sslFor(NEON).ca);

    /* and it survives pg's own parsing, which is what bit the default before */
    env({});
    const url = NEON + '?sslmode=verify-full';
    const cp = new ConnectionParameters({ connectionString: withoutSslMode(url), ssl: sslFor(url) });
    ok('rejectUnauthorized:true reaches the socket', cp.ssl && cp.ssl.rejectUnauthorized === true, JSON.stringify(cp.ssl));
  } finally {
    console.warn = warn;
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) {
  console.log(fails.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
