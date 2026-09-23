/* GET /api/health — is storage there, and does the schema exist yet.

   Answers 200 even when the database is missing, because "no storage on this
   deployment" is a supported configuration: the tool still works, guests can
   still use it, and nothing can be saved. A monitor should read `storage`,
   not the status code.
   ========================================================================= */
import { json, route } from '../_lib/http.js';
import { isConfigured, ensureSchema, rawQuery } from '../_lib/db.js';
import { SCHEMA_VERSION } from '../_lib/schema.js';
import { isGoogleEnabled } from '../_lib/google.js';
import { adminGateOn } from '../_lib/auth.js';

export default route({
  async GET(_req, res) {
    if (!isConfigured()) {
      json(res, 200, {
        ok: true,
        storage: 'unconfigured',
        auth: { password: false, google: false },
        message: 'DATABASE_URL is not set. Accounts and saving are off; the tool still works.',
      });
      return;
    }
    const started = Date.now();
    try {
      await ensureSchema();
      const r = await rawQuery('select v from schema_meta where k = $1', ['schema_version']);
      /* With a database and no ADMIN_EMAIL, nobody is the editor: every
         publish is refused (403 admin_unset) rather than left open to
         whoever registers. That is safe, but it is a misconfiguration — the
         site owner cannot publish either — so say so where a monitor will
         see it. /api/auth/me tells any visitor the same thing, so nothing
         here is news to an outsider. */
      const unset = !adminGateOn();
      if (unset) console.error('[health] ADMIN_EMAIL is not set; publishing is refused for everyone.');
      json(res, 200, {
        ok: !unset,
        storage: 'ready',
        auth: { password: true, google: isGoogleEnabled() },
        editor: unset ? 'nobody: ADMIN_EMAIL is not set, so every publish is refused' : 'one verified account',
        schemaVersion: Number(r.rows[0]?.v || 0),
        expectedSchemaVersion: SCHEMA_VERSION,
        ms: Date.now() - started,
        ...(unset
          ? {
              warning:
                'ADMIN_EMAIL is not set, but there is a database, so nobody can publish. ' +
                'Set ADMIN_EMAIL alongside DATABASE_URL, redeploy, and verify that ' +
                'address (sign in with Google as it, or run scripts/admin-user.mjs verify).',
              /* "It is in the dashboard" and "the function can see it" are
                 different things, and from outside they look the same. This
                 separates them without ever printing the address: either the
                 variable never reached this runtime — added after the build,
                 or not ticked for this environment — or it arrived holding
                 nothing usable. */
              adminEmail:
                process.env.ADMIN_EMAIL === undefined
                  ? 'not present in this deployment: added after the last build, ' +
                    'or not enabled for this environment. Redeploy after setting it.'
                  : 'present but empty: the value is blank or only separators',
            }
          : {}),
      });
    } catch (err) {
      console.error('[health] storage check failed:', err.message);
      json(res, 200, {
        ok: false,
        storage: 'unreachable',
        message: 'The database did not answer. Saving is unavailable; the tool still works.',
        ms: Date.now() - started,
      });
    }
  },
});
