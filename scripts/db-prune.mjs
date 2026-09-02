/* Housekeeping. Nothing here touches live work.

     npm run db:prune              expired sessions and stale login attempts
     npm run db:prune -- --trash 90  also purge work deleted over 90 days ago

   Run it from cron if you like; nothing breaks if it never runs — expired
   sessions are already refused at the door, and soft-deleted rows are already
   hidden from every listing. This only reclaims space.
   ========================================================================= */
import { loadEnv } from './env.mjs';
loadEnv();

const { isConfigured, rawQuery, getPool } = await import('../api/_lib/db.js');

if (!isConfigured()) {
  console.error('DATABASE_URL is not set. See .env.example.');
  process.exit(2);
}

const argv = process.argv.slice(2);
const trashIdx = argv.indexOf('--trash');
const trashDays = trashIdx >= 0 ? parseInt(argv[trashIdx + 1], 10) : 0;

try {
  const s = await rawQuery('delete from sessions where expires_at < now()');
  console.log(`${s.rowCount} expired session${s.rowCount === 1 ? '' : 's'} removed`);

  const a = await rawQuery(`delete from auth_attempts where at < now() - interval '1 day'`);
  console.log(`${a.rowCount} stale login attempt${a.rowCount === 1 ? '' : 's'} removed`);

  if (Number.isFinite(trashDays) && trashDays > 0) {
    for (const t of ['documents', 'runs', 'trees']) {
      const r = await rawQuery(
        `delete from ${t} where deleted_at is not null and deleted_at < now() - ($1 || ' days')::interval`,
        [String(trashDays)]
      );
      console.log(`${r.rowCount} deleted ${t} purged (older than ${trashDays} days)`);
    }
  } else if (trashIdx >= 0) {
    console.error('--trash needs a number of days, e.g. --trash 90');
    process.exitCode = 1;
  }
} catch (err) {
  console.error('prune failed: ' + (err.message || err));
  process.exitCode = 1;
} finally {
  await getPool().end().catch(() => {});
}
