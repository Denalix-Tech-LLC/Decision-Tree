/* Account administration from a terminal. There is no email path in this tool
   — no verification, no reset link — so the answer to "I have forgotten my
   password" is someone with database access running this.

     node scripts/admin-user.mjs list
     node scripts/admin-user.mjs show    someone@example.org
     node scripts/admin-user.mjs passwd  someone@example.org 'a new long passphrase'
     node scripts/admin-user.mjs signout someone@example.org
     node scripts/admin-user.mjs delete  someone@example.org --yes

   `passwd` ends every session on the account, because the reason for running
   it is usually that someone else may have had the old one. `delete` takes the
   account's saved work with it and cannot be undone, so it insists on --yes.
   Passwords are never printed or logged.
   ========================================================================= */
import { loadEnv } from './env.mjs';
loadEnv();

const { isConfigured, rawQuery, getPool } = await import('../api/_lib/db.js');
const { hashPassword, checkPassword, normaliseEmail, PASSWORD_MIN } = await import(
  '../api/_lib/auth.js'
);

if (!isConfigured()) {
  console.error('DATABASE_URL is not set. See .env.example.');
  process.exit(2);
}

const [cmd, email, ...rest] = process.argv.slice(2);
const yes = rest.includes('--yes') || process.argv.includes('--yes');

function need(what) {
  if (!email) {
    console.error('Which account? ' + what);
    process.exit(2);
  }
  return normaliseEmail(email);
}

async function find(addr) {
  const r = await rawQuery(
    'select id, email, name, created_at, last_login_at from users where lower(email) = lower($1)',
    [addr]
  );
  if (!r.rows.length) {
    console.error('No account with that address.');
    process.exit(1);
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

try {
  if (cmd === 'list') {
    const r = await rawQuery(
      `select u.id, u.email, u.name, u.created_at, u.last_login_at,
              (select count(*)::int from trees t where t.user_id=u.id and t.deleted_at is null) as trees,
              (select count(*)::int from runs  n where n.user_id=u.id and n.deleted_at is null) as runs,
              (select count(*)::int from documents d where d.user_id=u.id and d.deleted_at is null) as docs
         from users u order by u.created_at`
    );
    if (!r.rows.length) console.log('No accounts yet.');
    for (const u of r.rows) {
      console.log(
        `${u.email}\n  ${u.name || '(no name)'} · created ${String(u.created_at).slice(0, 10)}` +
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
        `  ${c.trees} trees · ${c.runs} paths · ${c.docs} documents · ${c.sessions} live sessions`
    );
  } else if (cmd === 'passwd') {
    const u = await find(need('set whose password?'));
    const pw = rest.filter((a) => a !== '--yes')[0];
    if (!pw) {
      console.error(`Give the new password as the last argument (at least ${PASSWORD_MIN} characters).`);
      process.exit(2);
    }
    const bad = checkPassword(pw, { email: u.email, name: u.name });
    if (bad) {
      console.error(bad);
      process.exit(1);
    }
    const hash = await hashPassword(pw);
    await rawQuery('update users set password_hash = $2, updated_at = now() where id = $1', [
      u.id,
      hash,
    ]);
    const gone = await rawQuery('delete from sessions where user_id = $1', [u.id]);
    console.log(
      `Password set for ${u.email}. ${gone.rowCount} session(s) ended — they will have to sign in again.`
    );
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
      process.exit(1);
    }
    await rawQuery('delete from users where id = $1', [u.id]);
    console.log(`${u.email} deleted, with ${c.trees + c.runs + c.docs} saved item(s).`);
  } else {
    console.log(
      'Usage:\n' +
        '  node scripts/admin-user.mjs list\n' +
        '  node scripts/admin-user.mjs show    someone@example.org\n' +
        '  node scripts/admin-user.mjs passwd  someone@example.org \'a new long passphrase\'\n' +
        '  node scripts/admin-user.mjs signout someone@example.org\n' +
        '  node scripts/admin-user.mjs delete  someone@example.org --yes'
    );
    process.exitCode = cmd ? 2 : 0;
  }
} catch (err) {
  console.error('failed: ' + (err.message || err));
  process.exitCode = 1;
} finally {
  await getPool().end().catch(() => {});
}
