/* ===========================================================================
   IS THIS CONNECTION STRING GOING TO WORK ON VERCEL?

     npm run db:check
     npm run db:check -- "postgres://user:pass@host:6543/postgres?sslmode=require"

   Reads DATABASE_URL from .env, or takes one as an argument so a candidate can
   be tried without saving it anywhere. It says what the string points at, what
   answered, and — when nothing did — which of the handful of things it actually
   was, because "connection failed" on its own costs an afternoon.

   Nothing here writes anything except the schema, which is `if not exists`
   throughout and is what the first real request would have created anyway.
   The password is never printed.
   ========================================================================= */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.mjs';

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
loadEnv();

const arg = process.argv.slice(2).find((a) => /^postgres(ql)?:\/\//i.test(a));
if (arg) process.env.DATABASE_URL = arg;

/* The app's own precedence, imported rather than copied: a checker that looks
   at a different variable than the app is a checker that passes while
   production is down. */
const { connectionString, connectionSource, URL_VARS } = await import('../api/_lib/db.js');

const URL_STR = connectionString();
if (!URL_STR) {
  console.error(
    '\nNo connection string.\n\n' +
      '  npm run db:check -- "postgres://user:pass@host:6543/postgres?sslmode=require"\n\n' +
      'or set one of ' +
      URL_VARS.join(', ') +
      ' in .env beside package.json.\nSee .env.example.\n'
  );
  process.exit(2);
}

/* Vercel's integrations inject several of these at once, and one of them is
   deliberately NOT pooled. Say which one is in play, and flag the trap. */
if (!arg) {
  const present = URL_VARS.filter((k) => process.env[k]);
  console.log('\nWhere this came from');
  console.log('  using     ' + connectionSource());
  if (present.length > 1) console.log('  also set  ' + present.slice(1).join(', '));
  const unpooled = ['DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING'].filter(
    (k) => process.env[k]
  );
  if (unpooled.length) {
    console.log(
      '  note      ' +
        unpooled.join(', ') +
        ' is set too. That one is the direct,\n            unpooled connection — do not point DATABASE_URL at it.'
    );
  }
}

let u;
try {
  u = new URL(URL_STR);
} catch {
  console.error('\nThat is not a URL. It should start postgres:// or postgresql://\n');
  process.exit(2);
}

const host = u.hostname;
const port = u.port || '5432';
const db = u.pathname.replace(/^\//, '') || '(default)';
const user = decodeURIComponent(u.username || '') || '(none)';

console.log('\nWhat this points at');
console.log('  host      ' + host);
console.log('  port      ' + port);
console.log('  database  ' + db);
console.log('  user      ' + user);
console.log('  password  ' + (u.password ? String(u.password.length) + ' characters' : 'NONE'));
console.log('  sslmode   ' + (u.searchParams.get('sslmode') || '(unset)'));

/* ---- what kind of host is this, before dialling it ---------------------- */
const notes = [];
const warns = [];
const isSupabase = /supabase/i.test(host);
const isSupabasePooler = /pooler\.supabase\.com$/i.test(host);
const isSupabaseDirect = /^db\.[a-z0-9]+\.supabase\.co$/i.test(host);
const isNeon = /neon\.tech$/i.test(host);

if (isSupabaseDirect) {
  warns.push(
    'This is Supabase’s DIRECT host. It resolves to IPv6 only, which Vercel’s\n' +
      '    functions generally cannot reach, and it is one connection per instance\n' +
      '    with no pooling. Use a Session or Transaction pooler string instead:\n' +
      '    Supabase → Project Settings → Database → Connection string → Transaction pooler.'
  );
} else if (isSupabasePooler) {
  if (port === '6543') {
    notes.push(
      'Supabase TRANSACTION pooler. This is the right one for Vercel. It holds no\n' +
        '    session state between statements, which this codebase is written for — the\n' +
        '    schema lock is transaction scoped, and no startup parameter is sent that\n' +
        '    a pooler could refuse.'
    );
  } else {
    notes.push(
      'Supabase SESSION pooler. Works, and keeps session state. The transaction\n' +
        '    pooler on port 6543 suits serverless better, but either is fine here.'
    );
  }
  if (!/^postgres\.[a-z0-9]+$/i.test(user)) {
    warns.push(
      'A pooler user is normally "postgres.<project-ref>". "' +
        user +
        '" may be the\n    direct-connection user, which the pooler will refuse.'
    );
  }
} else if (isNeon && !/-pooler\./i.test(host)) {
  warns.push(
    'This looks like Neon’s direct host. Use the -pooler one for serverless:\n' +
      '    ep-xxx-pooler.region.aws.neon.tech'
  );
}
if (!isSupabase && !isNeon && !/localhost|127\.0\.0\.1/.test(host)) {
  notes.push('Not a host this script recognises — the checks below still apply.');
}
if (u.password && /[ #?&/@]/.test(u.password)) {
  warns.push(
    'The password contains a character that needs percent-encoding in a URL\n' +
      '    (space # ? & / @). Copy the string from the provider rather than typing it.'
  );
}

if (notes.length) {
  console.log('\nNotes');
  notes.forEach((n) => console.log('  - ' + n));
}
if (warns.length) {
  console.log('\nWorth fixing first');
  warns.forEach((w) => console.log('  ! ' + w));
}

/* ---- now actually dial it ----------------------------------------------- */
const { ensureSchema, rawQuery, getPool } = await import('../api/_lib/db.js');

function diagnose(err) {
  const code = err && err.code;
  const msg = String((err && err.message) || err);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'The host name did not resolve. Check it for a typo, and that the\n  project still exists.';
  }
  if (code === 'ECONNREFUSED') {
    return 'Nothing is listening on that port. Supabase poolers are 5432 (session)\n  and 6543 (transaction).';
  }
  if (code === 'ETIMEDOUT' || /timeout/i.test(msg)) {
    return 'It did not answer in time. If this is Supabase’s direct db.*.supabase.co\n  host, it is IPv6-only — use a pooler string. Otherwise check IP restrictions.';
  }
  if (code === '28P01' || /password authentication failed/i.test(msg)) {
    return 'The password was refused. Reset it in the provider and copy the whole\n  string again — a percent-encoded character is easy to lose.';
  }
  if (code === '3D000' || /database .* does not exist/i.test(msg)) {
    return 'That database name does not exist on the server.';
  }
  if (/self.signed|certificate/i.test(msg)) {
    return 'TLS refused the certificate. This project turns verification off by\n  default, so something has set PGSSLMODE=verify-full.';
  }
  if (/unsupported startup parameter/i.test(msg)) {
    return 'The pooler refused a startup parameter. This codebase sends none that it\n  should not, so something in the connection string is asking for one — look\n  for options=... and remove it.';
  }
  if (/Tenant or user not found/i.test(msg)) {
    return 'Supabase did not recognise the user. On a pooler it must be\n  "postgres.<project-ref>", not plain "postgres".';
  }
  if (/max clients|too many connections/i.test(msg)) {
    return 'The connection limit is full. On a direct connection that is normal for\n  serverless — use the pooler.';
  }
  return msg;
}

let failed = false;
try {
  console.log('\nConnecting…');
  const t0 = Date.now();
  const v = await rawQuery('select version() as v, current_database() as db, current_user as who');
  console.log('  connected in ' + (Date.now() - t0) + ' ms');
  console.log('  ' + String(v.rows[0].v).split(',')[0]);
  console.log('  database  ' + v.rows[0].db);
  console.log('  user      ' + v.rows[0].who);

  const t1 = Date.now();
  await ensureSchema();
  console.log('\nSchema ready in ' + (Date.now() - t1) + ' ms');

  const t = await rawQuery(
    `select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`
  );
  const names = t.rows.map((r) => r.table_name);
  console.log('  tables          ' + (names.length ? names.join(', ') : '(none)'));

  for (const [label, sql] of [
    ['accounts', 'select count(*)::int as n from users'],
    ['saved trees', 'select count(*)::int as n from trees'],
    ['published tree', 'select count(*)::int as n from site_tree'],
  ]) {
    try {
      const r = await rawQuery(sql);
      console.log('  ' + label.padEnd(15) + ' ' + r.rows[0].n);
    } catch {
      console.log('  ' + label.padEnd(15) + ' (table not there)');
    }
  }

  /* the one that decides whether signing up is safe to turn on */
  const admin = String(process.env.ADMIN_EMAIL || '').trim();
  console.log('\nWho may edit the tree');
  if (admin) {
    console.log('  ADMIN_EMAIL is set: ' + admin);
    console.log('  Only that account can publish. This is the safe configuration.');
  } else {
    console.log('  ! ADMIN_EMAIL is NOT set.');
    console.log('    Registration is open, so with a database attached ANY account that');
    console.log('    signs up can publish the tree every reader sees. Set ADMIN_EMAIL in');
    console.log('    the same place as DATABASE_URL before you put this live.');
  }
  console.log('\nGood. This connection string will work on Vercel.\n');
} catch (err) {
  failed = true;
  console.error('\nThat did not work.\n');
  console.error('  ' + diagnose(err));
  if (err && err.code) console.error('\n  (postgres code ' + err.code + ')');
  console.error('');
} finally {
  try {
    await getPool().end();
  } catch {
    /* never connected */
  }
}
process.exit(failed ? 1 : 0);
