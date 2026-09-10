/* GET  /api/auth/me    who is signed in, how much they have saved, and which
                        ways in this deployment offers
   PATCH /api/auth/me   change the display name

   A guest is not an error here: GET answers 200 with user:null, so the page
   can lay out its account chip without treating "not signed in" as a failure.
   ========================================================================= */
import { json, readJson, route, str } from '../../_lib/http.js';
import { currentUser, requireUser, publicUser, signInMethods, adminGateOn, isAdminEmail } from '../../_lib/auth.js';
import { counts, LIMITS } from '../../_lib/records.js';
import { isConfigured, query } from '../../_lib/db.js';
import { isGoogleEnabled } from '../../_lib/google.js';

export default route({
  async GET(req, res) {
    if (!isConfigured()) {
      /* No database on this deployment: guest use is all there is, and the
         client needs to know that up front rather than after a failed save. */
      json(res, 200, {
        user: null,
        storage: 'unconfigured',
        auth: { password: false, google: false },
        /* no storage means no accounts to check against, so the editor cannot
           be gated on one — it stays open, as it was before accounts */
        adminGate: false,
        admin: false,
        limits: LIMITS,
      });
      return;
    }
    const offered = { password: true, google: isGoogleEnabled() };
    const gate = adminGateOn();
    const user = await currentUser(req, res);
    if (!user) {
      json(res, 200, {
        user: null,
        storage: 'ready',
        auth: offered,
        adminGate: gate,
        admin: false,
        limits: LIMITS,
      });
      return;
    }
    json(res, 200, {
      user: publicUser(user),
      storage: 'ready',
      auth: offered,
      adminGate: gate,
      /* with no gate configured the editor is open, so everyone signed in
         counts as able to use it */
      admin: gate ? isAdminEmail(user.email) : true,
      methods: await signInMethods(user.id),
      counts: await counts(user.id),
      limits: LIMITS,
    });
  },

  async PATCH(req, res) {
    const user = await requireUser(req, res);
    const body = await readJson(req);
    const name = str(body.name, { max: 120 });
    await query('update users set name = $2, updated_at = now() where id = $1', [user.id, name]);
    json(res, 200, { user: publicUser({ ...user, name }) });
  },
});
