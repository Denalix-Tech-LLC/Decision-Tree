/* Housekeeping. Nothing here touches live work.

     npm run db:prune                 expired sessions, stale login attempts
                                      and abandoned Google sign-ins
     npm run db:prune -- --trash 90   also purge work deleted over 90 days ago
     npm run db:prune -- --media      also delete uploaded images nothing uses

   --media removes an uploaded image when it is more than 7 days old and no
   published tree, saved tree (deleted ones included, since they can be
   restored) or saved path's snapshot mentions its hash. It is opt-in because
   one place it cannot see is the editor's own browser: a backdrop uploaded
   at /admin and left in an unpublished, unsaved draft for over a week looks
   unused from here, and after a prune that draft shows the plain page colour
   instead. Publish or save to an account first and it is safe.

   Run it from cron if you like; nothing breaks if it never runs — expired
   sessions are already refused at the door, and soft-deleted rows are already
   hidden from every listing. It does reclaim room that the limits count:
   deleted work counts toward each account's limits until it is purged
   (api/_lib/records.js LIMITS), and uploaded images toward the deployment's
   image budget (api/_lib/media.js), so --trash gives accounts room back and
   --media is the answer an upload refused as over budget points to.
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
const pruneMedia = argv.includes('--media');

try {
  /* Both of a session's clocks (api/_lib/auth.js): idle expiry, and the
     30-day absolute cap from sign-in, which the door already enforces but
     which leaves the row behind until something deletes it. */
  const s = await rawQuery(
    `delete from sessions where expires_at < now() or created_at < now() - interval '30 days'`
  );
  console.log(`${s.rowCount} expired session${s.rowCount === 1 ? '' : 's'} removed`);

  /* Half-finished Google sign-ins. The table arrives with a later schema
     version, so a database that predates it is skipped, not an error. */
  const o = await rawQuery(`select to_regclass('public.oauth_flows') is not null as present`);
  if (o.rows[0].present) {
    const f = await rawQuery('delete from oauth_flows where expires_at < now()');
    console.log(`${f.rowCount} expired Google sign-in${f.rowCount === 1 ? '' : 's'} removed`);
  }

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

  if (pruneMedia) {
    /* The table arrives with schema version 4; a database no deployment has
       touched since then has no images to prune, and saying so beats a
       "relation does not exist". */
    const t = await rawQuery(`select to_regclass('public.media') is not null as present`);
    if (!t.rows[0].present) {
      console.log('no media table yet — nothing has been uploaded to this database');
    } else {
      /* A text match on the hash is deliberately crude. A hash is 64 hex
         characters, so it does not turn up by accident, and matching the
         text catches every place a tree could carry it — THEME today,
         anywhere else tomorrow — without this script having to know. */
      const m = await rawQuery(
        `delete from media m
          where m.created_at < now() - interval '7 days'
            and not exists (select 1 from site_tree s where strpos(s.data::text, m.hash) > 0)
            and not exists (select 1 from trees t where strpos(t.data::text, m.hash) > 0)
            and not exists (select 1 from runs r
                             where r.snapshot is not null and strpos(r.snapshot::text, m.hash) > 0)`
      );
      console.log(
        `${m.rowCount} unused uploaded image${m.rowCount === 1 ? '' : 's'} removed (older than 7 days)`
      );
    }
  }
} catch (err) {
  console.error('prune failed: ' + (err.message || err));
  process.exitCode = 1;
} finally {
  await getPool().end().catch(() => {});
}
