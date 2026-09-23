/* Account administration from a terminal. There is no email path in this tool
   — no verification mail, no reset link — so the answer to "I have forgotten
   my password" and "prove this address is really the editor's" is someone
   with database access running this.

     node scripts/admin-user.mjs list
     node scripts/admin-user.mjs show    someone@example.org
     node scripts/admin-user.mjs create  someone@example.org [--name "Their Name"]
     node scripts/admin-user.mjs passwd  someone@example.org
     node scripts/admin-user.mjs verify  someone@example.org
     node scripts/admin-user.mjs signout someone@example.org
     node scripts/admin-user.mjs delete  someone@example.org --yes

   PASSWORDS ARE NEVER COMMAND-LINE ARGUMENTS. An argument lands in shell
   history and in the process list for anyone on the machine to read. `create`
   and `passwd` ask for the password at a hidden prompt (typed twice, nothing
   echoed). For automation, set TAS_NEW_PASSWORD in the environment from a
   secret store instead, or pipe the password in on stdin (first line). Do
   not type TAS_NEW_PASSWORD=... in front of the command: that is the same
   shell history by another name. A stray extra argument is refused rather
   than silently taken as the password.

   VERIFIED ADDRESSES. The editor at /admin needs the account named in
   ADMIN_EMAIL to have a verified address, and registering with a password
   never verifies one: nothing in that proves the person owns the address.
   Signing in with Google as the address verifies it; so does this script,
   because holding the database is already more than the editor can do.
   `create` and `passwd` mark the account verified — the person running them
   has just chosen its password. `verify` marks it verified as it stands:
   use it only for an account you know is the owner's (you can sign in to it
   with the password you set). If you are not sure who registered it, run
   `passwd` instead, which also replaces the password and ends every session.

   `passwd` ends every session on the account, because the reason for running
   it is usually that someone else may have had the old one. `delete` takes the
   account's saved work with it and cannot be undone, so it insists on --yes.
   Passwords are never printed or logged.
   ========================================================================= */
import crypto from 'node:crypto';
import { loadEnv } from './env.mjs';
loadEnv();

const { isConfigured, rawQuery, getPool, ensureSchema } = await import('../api/_lib/db.js');
const { hashPassword, checkPassword, checkEmail, normaliseEmail, PASSWORD_MIN } = await import(
  '../api/_lib/auth.js'
);

if (!isConfigured()) {
  console.error('DATABASE_URL is not set. See .env.example.');
  process.exit(2);
}

const argv = process.argv.slice(2);
const yes = argv.includes('--yes');
/* --name "Their Name" for create; every other --flag is taken out before the
   positional arguments are read. */
let nameArg = '';
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--yes') continue;
  if (a === '--name') {
    nameArg = String(argv[++i] || '');
    continue;
  }
  positional.push(a);
}
const [cmd, email, ...extra] = positional;

/* Ending early from inside the work below goes through here rather than
   process.exit(), so the finally at the foot still closes the connection. A
   killed connection is not always noticed promptly by the server, and a
   single-connection one (PGlite, in the self-test) then refuses the next. */
class Exit extends Error {
  constructor(exitCode) {
    super('exit ' + exitCode);
    this.exitCode = exitCode;
  }
}

function need(what) {
  if (!email) {
    console.error('Which account? ' + what);
    throw new Exit(2);
  }
  return normaliseEmail(email);
}

/* A password on the command line is refused outright, loudly, so nobody gets
   into the habit and nobody's old muscle memory from the previous version of
   this script sets a password they then find in their history. */
function refuseInlinePassword() {
  if (extra.length) {
    console.error(
      'Passwords are not taken as command-line arguments (they stay in shell history and the ' +
        'process list).\nRun it again without one: you will be asked at a hidden prompt, or set ' +
        'TAS_NEW_PASSWORD from a secret store, or pipe it on stdin.\nIf that argument was a ' +
        'password, remove it from your shell history.'
    );
    process.exit(2);
  }
}

/* Before anything touches the database, so a mistake costs nothing. */
if (cmd === 'create' || cmd === 'passwd') refuseInlinePassword();

/* One line from stdin, without echo when it is a terminal. */
function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(label);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const done = (err) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stdout.write('\n');
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return done();
        if (ch === '\u0003') return done(new Error('cancelled'));
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readStdinLine() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0];
}

async function newPassword(forEmail, forName) {
  let pw;
  if (process.env.TAS_NEW_PASSWORD) {
    pw = process.env.TAS_NEW_PASSWORD;
  } else if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    pw = await promptHidden(`New password for ${forEmail} (at least ${PASSWORD_MIN} characters): `);
    const again = await promptHidden('Type it again: ');
    if (pw !== again) {
      console.error('Those did not match. Nothing was changed.');
      throw new Exit(1);
    }
  } else {
    /* Piped in, or a terminal that cannot hide input (Git Bash's mintty
       without winpty). Reading a pipe is fine; an echoing terminal is not a
       place to type a password, so say how to get a real prompt. */
    if (process.stdin.isTTY) {
      console.error(
        'This terminal cannot hide what is typed. Run it from PowerShell or cmd, prefix it with ' +
          'winpty, or set TAS_NEW_PASSWORD from a secret store.'
      );
      throw new Exit(2);
    }
    pw = await readStdinLine();
  }
  const bad = checkPassword(pw, { email: forEmail, name: forName });
  if (bad) {
    console.error(bad);
    throw new Exit(1);
  }
  return pw;
}

async function find(addr) {
  const r = await rawQuery(
    `select id, email, name, created_at, last_login_at, email_verified,
            (password_hash is not null) as has_password, (google_sub is not null) as has_google
       from users where lower(email) = lower($1)`,
    [addr]
  );
  if (!r.rows.length) {
    console.error('No account with that address.');
    throw new Exit(1);
  }
  return r.rows[0];
}

async function counts(id) {
  const r = await rawQuery(
    `select (select count(*)::int from trees     where user_id=$1 and deleted_at is null) as trees,
            (select count(*)::int from runs      where user_id=$1 and deleted_at is null) as runs,
            (select count(*)::int from documents where user_id=$1 and deleted_at is null) as docs,
            (select count(*)::int from sessions  where user_id=$1 and expires_at > now()) as sessions`,
    [id]
  );
  return r.rows[0];
}

function ways(u) {
  return [u.has_password ? 'password' : null, u.has_google ? 'Google' : null].filter(Boolean).join(' + ') ||
    'no way in';
}

try {
  /* The same schema and migrations the site applies on its first request, so
     `verify` works against a database the new code has not served yet. Every
     step is additive and idempotent. */
  const COMMANDS = ['list', 'show', 'create', 'passwd', 'verify', 'signout', 'delete'];
  if (COMMANDS.includes(cmd)) await ensureSchema();

  if (cmd === 'list') {
    const r = await rawQuery(
      `select u.id, u.email, u.name, u.created_at, u.last_login_at, u.email_verified,
              (select count(*)::int from trees t where t.user_id=u.id and t.deleted_at is null) as trees,
              (select count(*)::int from runs  n where n.user_id=u.id and n.deleted_at is null) as runs,
              (select count(*)::int from documents d where d.user_id=u.id and d.deleted_at is null) as docs
         from users u order by u.created_at`
    );
    if (!r.rows.length) console.log('No accounts yet.');
    for (const u of r.rows) {
      console.log(
        `${u.email}${u.email_verified ? '  (verified)' : '  (not verified)'}\n` +
          `  ${u.name || '(no name)'} · created ${String(u.created_at).slice(0, 10)}` +
          ` · last signed in ${u.last_login_at ? String(u.last_login_at).slice(0, 10) : 'never'}` +
          `\n  ${u.trees} trees · ${u.runs} paths · ${u.docs} documents`
      );
    }
  } else if (cmd === 'show') {
    const u = await find(need('show whom?'));
    const c = await counts(u.id);
    console.log(
      `${u.email}\n  ${u.name || '(no name)'}\n  created ${u.created_at}\n` +
        `  last signed in ${u.last_login_at || 'never'}\n` +
        `  address ${u.email_verified ? 'verified' : 'NOT verified'} · signs in with ${ways(u)}\n` +
        `  ${c.trees} trees · ${c.runs} paths · ${c.docs} documents · ${c.sessions} live sessions`
    );
  } else if (cmd === 'create') {
    const addr = need('create an account for which address?');
    const e = checkEmail(addr);
    if (e) {
      console.error(e);
      throw new Exit(1);
    }
    const taken = await rawQuery('select 1 from users where lower(email) = lower($1)', [addr]);
    if (taken.rows.length) {
      console.error(
        'There is already an account with that address. Use `passwd` to take it over with a new ' +
          'password (that also verifies it and ends its sessions).'
      );
      throw new Exit(1);
    }
    const name = nameArg.trim().slice(0, 120);
    const pw = await newPassword(addr, name);
    const hash = await hashPassword(pw);
    await rawQuery(
      `insert into users (id, email, name, password_hash, email_verified)
       values ($1, $2, $3, $4, true)`,
      [crypto.randomUUID(), addr, name, hash]
    );
    console.log(`Account created for ${addr}, address verified. Sign in with the password you just set.`);
  } else if (cmd === 'passwd') {
    const u = await find(need('set whose password?'));
    const pw = await newPassword(u.email, u.name);
    const hash = await hashPassword(pw);
    await rawQuery(
      'update users set password_hash = $2, email_verified = true, updated_at = now() where id = $1',
      [u.id, hash]
    );
    const gone = await rawQuery('delete from sessions where user_id = $1', [u.id]);
    console.log(
      `Password set for ${u.email}, address verified. ${gone.rowCount} session(s) ended — ` +
        'they will have to sign in again.'
    );
  } else if (cmd === 'verify') {
    const u = await find(need('verify whose address?'));
    if (u.email_verified) {
      console.log(`${u.email} is already verified.`);
    } else {
      await rawQuery('update users set email_verified = true, updated_at = now() where id = $1', [u.id]);
      console.log(
        `${u.email} is now verified (signs in with ${ways(u)}, created ${String(u.created_at).slice(0, 10)}).\n` +
          'If you are not certain this account was registered by the address’s owner, run ' +
          '`passwd` for it now: that replaces the password and ends every session on it.'
      );
    }
  } else if (cmd === 'signout') {
    const u = await find(need('sign whom out?'));
    const gone = await rawQuery('delete from sessions where user_id = $1', [u.id]);
    console.log(`${gone.rowCount} session(s) ended for ${u.email}.`);
  } else if (cmd === 'delete') {
    const u = await find(need('delete whom?'));
    const c = await counts(u.id);
    if (!yes) {
      console.error(
        `This deletes ${u.email} and everything on the account — ` +
          `${c.trees} trees, ${c.runs} paths, ${c.docs} documents, including anything already deleted.\n` +
          'It cannot be undone. Run it again with --yes if that is what you mean.'
      );
      throw new Exit(1);
    }
    await rawQuery('delete from users where id = $1', [u.id]);
    console.log(`${u.email} deleted, with ${c.trees + c.runs + c.docs} saved item(s).`);
  } else {
    console.log(
      'Usage:\n' +
        '  node scripts/admin-user.mjs list\n' +
        '  node scripts/admin-user.mjs show    someone@example.org\n' +
        '  node scripts/admin-user.mjs create  someone@example.org [--name "Their Name"]\n' +
        '  node scripts/admin-user.mjs passwd  someone@example.org\n' +
        '  node scripts/admin-user.mjs verify  someone@example.org\n' +
        '  node scripts/admin-user.mjs signout someone@example.org\n' +
        '  node scripts/admin-user.mjs delete  someone@example.org --yes\n\n' +
        'create and passwd ask for the password at a hidden prompt. For automation, set\n' +
        'TAS_NEW_PASSWORD from a secret store or pipe the password on stdin. It is never\n' +
        'taken as an argument.'
    );
    process.exitCode = cmd ? 2 : 0;
  }
} catch (err) {
  if (err instanceof Exit) {
    process.exitCode = err.exitCode;
  } else {
    console.error('failed: ' + (err.message || err));
    process.exitCode = 1;
  }
} finally {
  await getPool().end().catch(() => {});
}
