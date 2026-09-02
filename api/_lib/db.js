/* ===========================================================================
   THE DATABASE
   Postgres over `pg`, with the pool held at module scope so a warm serverless
   instance reuses one connection instead of opening a new one per request.
   `max: 1` is deliberate: each function instance serves one request at a time,
   so a bigger pool only burns connection slots on the server.

   DATABASE_URL is the only required setting. Anything Postgres works — Neon,
   Supabase, Vercel Postgres, RDS, or a local server. Use the *pooled* host on
   Neon or Supabase if one is offered.
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

function connectionString() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    ''
  );
}

export function isConfigured() {
  return !!connectionString();
}

/* TLS: managed Postgres all speaks TLS, and its certificates are usually
   signed by a chain Node does not carry, so verification is off unless
   PGSSLMODE=verify-full is set deliberately. A plain local server on
   localhost needs no TLS at all. */
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
      connectionString: url,
      ssl: sslFor(url),
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      statement_timeout: 12_000,
      query_timeout: 12_000,
      application_name: 'tas-decision-tree',
    });
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
  ready = (async () => {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('select pg_advisory_lock($1)', [727_144_001]);
      try {
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
      } finally {
        await client.query('select pg_advisory_unlock($1)', [727_144_001]);
      }
    } catch (err) {
      ready = null; /* a failed init must be retried, not cached */
      throw err;
    } finally {
      client.release();
    }
  })();
  return ready;
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
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    try {
      await client.query('rollback');
    } catch {
      /* the connection is already gone; the transaction died with it */
    }
    throw err;
  } finally {
    client.release();
  }
}

export function isUniqueViolation(err) {
  return err && err.code === '23505';
}
