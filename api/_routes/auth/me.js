/* GET  /api/auth/me    who is signed in, how much they have saved, and which
                        ways in this deployment offers
   PATCH /api/auth/me   change the display name

   A guest is not an error here: GET answers 200 with user:null, so the page
   can lay out its account chip without treating "not signed in" as a failure.

   `admin` is the editor rule from auth.js (isAdmin): named in ADMIN_EMAIL
   AND the address proven. `adminReason` says why not, when there is a reason
   worth telling: 'admin_unset' (a database, but no ADMIN_EMAIL, so nobody may
   publish) or 'admin_unverified' (this is the editor's address, not yet
   proven). The second is only ever told to someone signed in as that
   address, so the page never learns whose address ADMIN_EMAIL holds.
   `recentAuthUntil` is when this session stops counting as a recent
   sign-in, so a page can ask the person to confirm who they are BEFORE a
   sensitive change that happens by navigation (attaching Google).
   ========================================================================= */
import { json, readJson, route, str } from '../../_lib/http.js';
import {
  currentUser,
  requireUser,
  publicUser,
  signInMethods,
  adminGateOn,
  isAdmin,
  adminReason,
  recentAuthUntil,
} from '../../_lib/auth.js';
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
        adminReason: gate ? null : 'admin_unset',
        limits: LIMITS,
      });
      return;
    }
    json(res, 200, {
      user: publicUser(user),
      storage: 'ready',
      auth: offered,
      adminGate: gate,
      /* With storage and no ADMIN_EMAIL nobody is the editor: the server
         refuses every publish then, so the page must not offer one. */
      admin: isAdmin(user),
      adminReason: adminReason(user),
      recentAuthUntil: recentAuthUntil(user),
      methods: await signInMethods(user.id),
      counts: await counts(user.id),
      limits: LIMITS,
    });
  },

  async PATCH(req, res) {
    const user = await requireUser(req, res);
    const body = (await readJson(req)) || {};
    const name = str(body.name, { max: 120 });
    await query('update users set name = $2, updated_at = now() where id = $1', [user.id, name]);
    json(res, 200, { user: publicUser({ ...user, name }) });
  },
});
