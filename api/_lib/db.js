/* ===========================================================================
   THE DATABASE
   Postgres over `pg`, with the pool held at module scope so a warm serverless
   instance reuses one connection instead of opening a new one per request.
   `max: 1` is deliberate: each function instance serves one request at a time,
   so a bigger pool only burns connection slots on the server.

   DATABASE_URL is the only required setting. Anything Postgres works — Neon,
   Supabase, Vercel Postgres, RDS, or a local server. Use the *pooled* host on
   Neon or Supabase if one is offered.

   Everything here has to survive a TRANSACTION POOLER, which is what Supabase
   hands out for serverless and what Vercel wants you to use. Two rules follow
   from it, and breaking either one fails only in production:

     - No session state. A statement outside an explicit transaction may land
       on a different backend than the one before it, so anything session
       scoped — SET, session advisory locks, prepared statements by name —
       cannot be relied on to still be there. ensureSchema() takes a
       transaction-scoped lock inside one explicit transaction for exactly
       this reason.
     - No unusual startup parameters. A pooler refuses the whole connection
       over one it does not recognise, so statement_timeout is applied after
       connect and allowed to fail.
   ========================================================================= */
import pg from 'pg';
import { SCHEMA_SQL, SCHEMA_VERSION, MIGRATIONS } from './schema.js';

const { Pool } = pg;

/* Timestamps come back as ISO strings rather than JS Date objects, because
   everything here is on its way to JSON and a Date round-trips through the
   local timezone on the way. 1114 = timestamp, 1184 = timestamptz. */
pg.types.setTypeParser(1114, (v) => (v === null ? null : new Date(v + 'Z').toISOString()));
pg.types.setTypeParser(1184, (v) => (v === null ? null : new Date(v).toISOString()));

export class DbUnconfigured extends Error {
  constructor() {
    super('DATABASE_URL is not set');
    this.code = 'db_unconfigured';
  }
}

let pool = null;
let ready = null; /* a promise, so concurrent first requests wait on one init */

/* Which variable wins, in order. Exported because scripts/db-check.mjs has to
   test the string the app will actually use: a checker looking at a different
   variable than the app is a checker that passes while production is down. */
export const URL_VARS = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL'];

export function connectionString() {
  for (const k of URL_VARS) {
    if (process.env[k]) return process.env[k];
  }
  return '';
}

/* Which one it came from, for anything that has to explain itself. */
export function connectionSource() {
  for (const k of URL_VARS) {
    if (process.env[k]) return k;
  }
  return null;
}

export function isConfigured() {
  return !!connectionString();
}

/* TLS: managed Postgres all speaks TLS, and its certificates are usually
   signed by a chain Node does not carry, so verification is off unless
   PGSSLMODE=verify-full is set deliberately. A plain local server on
   localhost needs no TLS at all. */
/* node-postgres parses the connection string AFTER applying the config
   object, and a `sslmode` in the string replaces whatever `ssl` we passed:

     ?sslmode=require + ssl:{rejectUnauthorized:false}  ->  {}   (verify on)
     ?sslmode=require + ssl:false                       ->  {}   (PGSSL=off ignored)

   pg also treats `require` as an alias for `verify-full`, and says so in a
   runtime warning. Every managed provider hands out a URL with sslmode in it,
   so this quietly forced certificate verification on against chains Node does
   not carry — SELF_SIGNED_CERT_IN_CHAIN, on the pooler, at the first request.

   The parameter is therefore removed from the string and the decision left to
   sslFor(), which still reads the ORIGINAL url so sslmode=disable keeps
   working. Only the query is touched; the userinfo, where the password lives,
   is never re-encoded. */
export function withoutSslMode(url) {
  const i = url.indexOf('?');
  if (i < 0) return url;
  const base = url.slice(0, i);
  const kept = url
    .slice(i + 1)
    .split('&')
    .filter((p) => p && !/^sslmode=/i.test(p));
  return kept.length ? base + '?' + kept.join('&') : base;
}

function sslFor(url) {
  if (process.env.PGSSL === 'off') return false;
  if (/^postgres(ql)?:\/\/[^/]*@?(localhost|127\.0\.0\.1|\[::1\])(:|\/)/i.test(url)) return false;
  if (/sslmode=disable/i.test(url)) return false;
  if (process.env.PGSSLMODE === 'verify-full') return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

export function getPool() {
  const url = connectionString();
  if (!url) throw new DbUnconfigured();
  if (!pool) {
    pool = new Pool({
      connectionString: withoutSslMode(url),
      ssl: sslFor(url),
      max: 1,
      idleTimeoutMillis: 10_000,
      /* These have to fit INSIDE the function's own budget, which is 10s on
         Vercel's Hobby plan. Longer than that and the platform kills the
         request first: the reader gets a 504 with a platform page instead of
         the tool's own 503 and its "your work has not been saved". */
      connectionTimeoutMillis: 4_000,
      /* Client side, enforced by pg itself, so it holds on every kind of
         connection. This is the timeout that is actually guaranteed. */
      query_timeout: 7_000,
      application_name: 'tas-decision-tree',
    });
    /* There is deliberately no server-side statement_timeout on the pool.
       node-postgres sends that one in the startup packet and a pooler refuses
       the whole connection over a startup parameter it does not know; setting
       it from a 'connect' listener instead races the first real query, because
       the pool does not await that listener. Where it genuinely matters — the
       schema transaction, which holds a lock — it is set with SET LOCAL. */
    /* An idle client dropped by the far end must not take the process with
       it — the next query opens a fresh one. */
    pool.on('error', (err) => {
      console.error('[db] idle client error:', err.message);
    });
  }
  return pool;
}

/* Create the schema if it is not there yet. Guarded by a Postgres advisory
   lock so two cold functions starting at once cannot both run the DDL, and
   memoised per instance so it costs one round trip per cold start, not one
   per request. */
export async function ensureSchema() {
  if (ready) return ready;
  const attempt = (async () => {
    const p = getPool();
    /* connect() is inside the try on purpose. It used to sit outside, so a
       refused connection — pooler at max clients, Supavisor restarting, a DNS
       blip — rejected the memo below without ever reaching the catch that
       clears it. Every later query on that warm instance then awaited the same
       dead promise without opening a socket, for as long as Vercel kept the
       instance alive. */
    let client = null;
    try {
      client = await p.connect();
      /* A client checked out by hand has no error listener: pg-pool attaches
         one only while the client is idle in the pool. Without this, a
         connection the pooler drops mid-transaction reaches an EventEmitter
         with no listener and Node takes the whole instance down with it. */
      client.on('error', (e) => console.error('[db] client error:', e.message));
      /* One transaction start to finish: the lock, the DDL and the bookkeeping
         all land on the same backend, and the lock goes when the transaction
         does whether it commits or rolls back. There is no unlock to forget,
         and none to strand on a pooled connection somebody else then gets.
         Every statement below is transactional DDL — nothing CONCURRENTLY. */
      await client.query('begin');
      /* SET LOCAL: scoped to this transaction, so it needs no session state and
         cannot leak onto a pooled backend somebody else is handed next. */
      await client.query('set local statement_timeout = 20000');
      await client.query('select pg_advisory_xact_lock($1)', [727_144_001]);
      await client.query(SCHEMA_SQL);
      for (const m of MIGRATIONS) {
        const { rowCount } = await client.query('select 1 from schema_meta where k = $1', [
          'migration:' + m.key,
        ]);
        if (rowCount) continue;
        await client.query(m.sql);
        await client.query(
          `insert into schema_meta (k, v) values ($1, $2)
           on conflict (k) do update set v = excluded.v, updated_at = now()`,
          ['migration:' + m.key, new Date().toISOString()]
        );
      }
      await client.query(
        `insert into schema_meta (k, v) values ('schema_version', $1)
         on conflict (k) do update set v = excluded.v, updated_at = now()`,
        [String(SCHEMA_VERSION)]
      );
      await client.query('commit');
    } catch (err) {
      if (client) {
        try {
          await client.query('rollback');
        } catch {
          /* the connection is already gone; the transaction died with it */
        }
      }
      throw err;
    } finally {
      /* Handing back a client whose transaction may still be open would give
         the next caller a poisoned connection, so a failure releases it with
         the error and pg-pool discards it. */
      if (client) client.release();
    }
  })();
  ready = attempt;
  /* Clear the memo on ANY rejection, including one from connect(), and clear
     it against this exact attempt so a later successful init is not undone by
     an older failure landing late. */
  attempt.catch(() => {
    if (ready === attempt) ready = null;
  });
  return attempt;
}

export async function query(text, params) {
  await ensureSchema();
  return getPool().query(text, params);
}

/* Same as query(), but skips ensureSchema() — for callers inside init or in
   the standalone scripts, where the schema is already known to be there. */
export async function rawQuery(text, params) {
  return getPool().query(text, params);
}

export async function one(text, params) {
  const r = await query(text, params);
  return r.rows[0] || null;
}

export async function many(text, params) {
  const r = await query(text, params);
  return r.rows;
}

export async function tx(fn) {
  await ensureSchema();
  const client = await getPool().connect();
  /* Same reason as ensureSchema: while a client is checked out, nothing else
     is listening for its errors, and an unheard 'error' event is fatal. */
  client.on('error', (e) => console.error('[db] client error:', e.message));
  let broken = null;
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    broken = err;
    try {
      await client.query('rollback');
      /* the rollback got through, so the connection is clean to reuse */
      broken = null;
    } catch {
      /* Either the connection is gone, or the rollback timed out behind a
         statement still running on the server — query_timeout does not cancel
         that statement, so the transaction may still be open. Either way this
         connection is not safe to hand to the next caller. */
    }
    throw err;
  } finally {
    /* release(err) makes pg-pool destroy the client instead of pooling it */
    client.release(broken || undefined);
  }
}

export function isUniqueViolation(err) {
  return err && err.code === '23505';
}
