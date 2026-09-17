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
      /* Leaving ADMIN_EMAIL unset means "no gate", which is the right answer
         for a deployment with no database: there are no accounts, so there is
         nobody to gate against, and the editor stays open the way it did
         before accounts existed.

         With storage READY that reasoning is gone. Accounts exist, anyone can
         register, and PUT /api/tree publishes to every reader gated on this
         and nothing else — so the combination is a misconfiguration rather
         than a mode, and it is the one that looks fine until someone rewrites
         what a Council is shown. Say so where a monitor will see it. */
      const unprotected = !adminGateOn();
      json(res, 200, {
        ok: !unprotected,
        storage: 'ready',
        auth: { password: true, google: isGoogleEnabled() },
        editor: unprotected ? 'open to any account' : 'one account',
        schemaVersion: Number(r.rows[0]?.v || 0),
        expectedSchemaVersion: SCHEMA_VERSION,
        ms: Date.now() - started,
        ...(unprotected
          ? {
              warning:
                'ADMIN_EMAIL is not set, but there is a database. Anyone who registers ' +
                'can publish the tree every reader sees. Set ADMIN_EMAIL alongside ' +
                'DATABASE_URL and redeploy.',
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
