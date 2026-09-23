/* ===========================================================================
   ONE ERROR LISTENER PER CHECKOUT, AND GONE AGAIN ON RELEASE

     node scripts/db-listeners.mjs      (part of npm run selftest)

   tx() and ensureSchema() check a client out by hand and attach an 'error'
   listener, because pg-pool listens only while the client sits idle. They
   used to leave that listener behind. With max: 1 the pool hands the SAME
   client to every request on a warm instance, and every sign-in, registration,
   password check and save runs through tx(), so the listeners piled up — one
   closure per request, each client error logged N times, and Node printing
   MaxListenersExceededWarning after about ten requests.

   This runs many transactions, committed and rolled back, against a real
   Postgres (PGlite) and checks the count does not grow.
   ========================================================================= */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPglite } from './pglite.mjs';

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

const warnings = [];
process.on('warning', (w) => warnings.push(w));

const pg = await startPglite();
if (!pg) {
  console.log('db-listeners: PGlite is not installed (npm install), skipping.');
  process.exit(0);
}

for (const k of ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'PGSSLMODE', 'PGSSLROOTCERT']) {
  delete process.env[k];
}
process.env.DATABASE_URL = pg.url;

let code = 0;
try {
  const db = await import('../api/_lib/db.js');
  console.log('\nError listeners on a pooled client across many transactions');

  /* How many 'error' listeners the one pooled client has while checked out
     by hand, with nothing of ours attached. */
  async function checkedOutCount() {
    const client = await db.getPool().connect();
    try {
      return client.listenerCount('error');
    } finally {
      client.release();
    }
  }

  await db.tx((c) => c.query('select 1'));
  const before = await checkedOutCount();

  for (let i = 0; i < 30; i++) await db.tx((c) => c.query('select $1::int', [i]));
  for (let i = 0; i < 5; i++) {
    try {
      await db.tx(async (c) => {
        await c.query('select 1');
        throw new Error('deliberate');
      });
    } catch {
      /* expected: the transaction rolls back and the client goes back clean */
    }
  }
  const after = await checkedOutCount();

  ok(
    '35 transactions leave the listener count where it was',
    after === before,
    `before ${before}, after ${after}`
  );

  /* and while tx() holds the client, exactly one more than that: ours */
  const during = await db.tx(async (c) => c.listenerCount('error'));
  ok('tx() adds exactly one listener while it holds the client', during === before + 1, `${during}`);

  await new Promise((r) => setImmediate(r));
  const leak = warnings.filter((w) => w && w.name === 'MaxListenersExceededWarning');
  ok('no MaxListenersExceededWarning', leak.length === 0, leak.map((w) => w.message).join('; '));

  await db.getPool().end();
} catch (err) {
  fails.push('crashed — ' + (err && err.stack ? err.stack : err));
  console.log('  FAIL crashed — ' + (err && err.stack ? err.stack : err));
} finally {
  await pg.stop();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) code = 1;
process.exit(code);
