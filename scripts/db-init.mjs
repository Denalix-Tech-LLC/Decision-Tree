/* Create the schema, then say what is there.

     npm run db:init

   Safe to run against a live database: every statement in the schema is
   `if not exists`, so this creates what is missing and touches nothing that
   is already there. The functions also do this by themselves on a cold start
   — this script is for the case where you want to see it happen, and to fail
   loudly at setup time rather than on someone's first save.
   ========================================================================= */
import { loadEnv } from './env.mjs';
loadEnv();

const { isConfigured, ensureSchema, rawQuery, getPool } = await import('../api/_lib/db.js');
const { SCHEMA_VERSION } = await import('../api/_lib/schema.js');

if (!isConfigured()) {
  console.error(
    'DATABASE_URL is not set.\n\n' +
      'Put it in .env beside package.json, or export it:\n' +
      '  DATABASE_URL=postgres://user:pass@host/dbname\n\n' +
      'Any Postgres works — Neon, Supabase, Vercel Postgres, RDS, or a local server.\n' +
      'See .env.example.'
  );
  process.exit(2);
}

try {
  const started = Date.now();
  await ensureSchema();
  const tables = await rawQuery(
    `select table_name,
            (select count(*) from information_schema.columns c
              where c.table_name = t.table_name and c.table_schema = 'public') as cols
       from information_schema.tables t
      where table_schema = 'public'
        and table_name in ('users','sessions','auth_attempts','trees','runs','documents','schema_meta')
      order by table_name`
  );
  const users = await rawQuery('select count(*)::int as n from users');
  console.log(`schema ready in ${Date.now() - started} ms (version ${SCHEMA_VERSION})`);
  for (const r of tables.rows) console.log(`  ${r.table_name.padEnd(15)} ${r.cols} columns`);
  console.log(`\n${users.rows[0].n} account${users.rows[0].n === 1 ? '' : 's'} registered.`);
  if (tables.rows.length < 7) {
    console.error('\nSome tables are missing. Check the role has CREATE on the public schema.');
    process.exitCode = 1;
  }
} catch (err) {
  console.error('\nCould not prepare the database:\n  ' + (err.message || err));
  if (err.code === '42501') {
    console.error('  The role is not allowed to create tables in this schema.');
  }
  process.exitCode = 1;
} finally {
  await getPool().end().catch(() => {});
}
