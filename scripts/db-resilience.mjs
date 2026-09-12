/* ===========================================================================
   THE THREE WAYS A MANAGED POSTGRES GOES WRONG

     npm run selftest:db

   None of these show up against a local database, and all three were live in
   this codebase until they were looked for. They are the failure modes a
   transaction pooler actually produces — a TLS chain Node does not carry, a
   refused connection at a cold start, and a connection cut mid-transaction —
   so they are reproduced here rather than trusted to review.
   ========================================================================= */
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

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

/* ---- 1. TLS ------------------------------------------------------------- */
/* node-postgres applies the config object first and the parsed connection
   string second, so a `sslmode` in the string replaces whatever ssl we passed,
   and pg treats sslmode=require as verify-full. Every managed provider hands
   out such a URL, which made sslFor() dead code and forced verification on. */
console.log('\nTLS: sslFor() must survive a ?sslmode= in the connection string');
{
  const ConnectionParameters = (await import('pg/lib/connection-parameters.js')).default;
  const { withoutSslMode } = await import('../api/_lib/db.js');

  const cleaned = withoutSslMode(
    'postgres://u:p%40ss@h.pooler.supabase.com:6543/db?sslmode=require&application_name=x'
  );
  ok('sslmode is removed', !/sslmode/i.test(cleaned), cleaned);
  ok('other parameters survive', /application_name=x/.test(cleaned), cleaned);
  ok('the password is not re-encoded', cleaned.includes('u:p%40ss@'), cleaned);
  ok(
    'a url with no query is untouched',
    withoutSslMode('postgres://u:p@h/db') === 'postgres://u:p@h/db'
  );
  ok(
    'a lone sslmode leaves no dangling ?',
    withoutSslMode('postgres://u:p@h/db?sslmode=require') === 'postgres://u:p@h/db'
  );

  const cp = new ConnectionParameters({
    connectionString: cleaned,
    ssl: { rejectUnauthorized: false },
  });
  ok(
    'rejectUnauthorized:false reaches the socket',
    cp.ssl && cp.ssl.rejectUnauthorized === false,
    JSON.stringify(cp.ssl)
  );

  /* and the regression itself, so the reason this exists stays visible */
  const naive = new ConnectionParameters({
    connectionString: 'postgres://u:p@h/db?sslmode=require',
    ssl: { rejectUnauthorized: false },
  });
  ok(
    'without the strip, pg would still discard it (the bug being guarded)',
    !(naive.ssl && naive.ssl.rejectUnauthorized === false),
    JSON.stringify(naive.ssl)
  );
}

/* ---- 1b. which variable the connection comes from ----------------------- */
/* Vercel's storage integrations offer a Custom Prefix — STORAGE_URL, MYDB_URL —
   and also write an unpooled twin meant for migrations. Picking the twin would
   open a connection per serverless instance and exhaust the server. */
console.log('\nConfig: finding the right variable among the ones a platform sets');
{
  const saved = { ...process.env };
  const clear = () => {
    for (const k of Object.keys(process.env)) {
      if (/^(DATABASE|POSTGRES|STORAGE|MYDB)/.test(k)) delete process.env[k];
    }
  };
  const { connectionSource, connectionString } = await import('../api/_lib/db.js?vars');

  clear();
  process.env.DATABASE_URL = 'postgres://u:p@a/db';
  process.env.POSTGRES_URL = 'postgres://u:p@b/db';
  ok('DATABASE_URL wins when several are set', connectionSource() === 'DATABASE_URL');

  clear();
  process.env.POSTGRES_PRISMA_URL = 'postgres://u:p@c/db?pgbouncer=true';
  ok('POSTGRES_PRISMA_URL alone is found', connectionSource() === 'POSTGRES_PRISMA_URL');

  clear();
  process.env.DATABASE_URL = ''; /* the empty one a project may already carry */
  process.env.STORAGE_URL = 'postgres://u:p@pooled/db';
  process.env.STORAGE_URL_UNPOOLED = 'postgres://u:p@direct/db';
  process.env.STORAGE_URL_NON_POOLING = 'postgres://u:p@direct2/db';
  ok('a custom prefix is found', connectionSource() === 'STORAGE_URL', String(connectionSource()));
  ok('the unpooled twin is never chosen', !/direct/.test(connectionString()), connectionString());

  clear();
  process.env.MYDB_URL_UNPOOLED = 'postgres://u:p@direct/db';
  ok('an unpooled variable alone is not used', connectionSource() === null, String(connectionSource()));

  clear();
  process.env.SOME_OTHER_URL = 'https://example.com';
  ok('a non-postgres URL is ignored', connectionSource() === null, String(connectionSource()));

  clear();
  for (const [k, v] of Object.entries(saved)) process.env[k] = v;
}

/* ---- 2. a refused connect at a cold start ------------------------------- */
/* ensureSchema memoises its promise. If connect() rejects and the memo is not
   cleared, every later query on that warm instance awaits the same dead
   promise without opening a socket — one two-second pooler blip and the
   instance is broken for as long as Vercel keeps it. */
console.log('\nCold start: a refused connection must not brick the instance');
{
  let connects = 0;
  const hostile = net.createServer((sock) => {
    connects++;
    sock.destroy();
  });
  await new Promise((r) => hostile.listen(0, '127.0.0.1', r));
  process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:' + hostile.address().port + '/db';
  process.env.PGSSL = 'off';

  const db = await import('../api/_lib/db.js?refused');
  let first = null;
  try {
    await db.query('select 1');
  } catch (e) {
    first = e;
  }
  ok('the first request fails', !!first, first && first.message);
  const after1 = connects;

  let second = null;
  try {
    await db.query('select 1');
  } catch (e) {
    second = e;
  }
  ok(
    'the second request tries the network again',
    connects > after1,
    'tcp connects: ' + after1 + ' -> ' + connects
  );
  ok('it is not the identical cached error object', first !== second);

  await new Promise((r) => hostile.close(r));
  try {
    await db.getPool().end();
  } catch {
    /* never connected */
  }
}

/* ---- 3. a connection cut mid-transaction -------------------------------- */
/* pg-pool attaches an 'error' listener only while a client is idle IN the
   pool. A client checked out by hand has none, so a dropped connection reaches
   an EventEmitter with no listener and Node takes the process down — which on
   Vercel is FUNCTION_INVOCATION_FAILED for every request on that instance. */
console.log('\nA pooler dropping a connection mid-transaction');
{
  const { startPglite } = await import('./pglite.mjs');
  const temp = await startPglite();
  if (!temp) {
    console.error('  (skipped: PGlite is not installed — run npm install)');
  } else {
    process.env.DATABASE_URL = temp.url;
    process.env.PGSSL = 'off';
    const db = await import('../api/_lib/db.js?dropped');

    let died = false;
    const onUncaught = () => {
      died = true;
    };
    process.on('uncaughtException', onUncaught);

    await db.query('select 1'); /* warm the schema */

    let threw = null;
    try {
      await db.tx(async (c) => {
        await c.query('select 1');
        c.connection.stream.destroy(
          Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })
        );
        await new Promise((r) => setTimeout(r, 120));
        await c.query('select 2');
      });
    } catch (e) {
      threw = e;
    }
    await new Promise((r) => setTimeout(r, 250));
    ok('tx() rejects rather than crashing', !!threw, threw && threw.message);
    ok('the process survived', !died);

    let after = null;
    try {
      after = (await db.query('select 42 as n')).rows[0].n;
    } catch (e) {
      after = 'threw: ' + e.message;
    }
    ok('the pool recovers for the next request', after === 42, String(after));

    process.off('uncaughtException', onUncaught);
    try {
      await db.getPool().end();
    } catch {
      /* already closed */
    }
    await temp.stop();
  }
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) {
  console.log(fails.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
