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
      json(res, 200, {
        ok: true,
        storage: 'ready',
        auth: { password: true, google: isGoogleEnabled() },
        schemaVersion: Number(r.rows[0]?.v || 0),
        expectedSchemaVersion: SCHEMA_VERSION,
        ms: Date.now() - started,
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
