/* POST /api/auth/google/unlink — detach the Google account from this one.

   Refused when it is the only way in: an account nobody can sign in to is a
   deleted account with extra steps, and deleting is a decision someone should
   make on purpose, in the dialog that says what goes with it.
   ========================================================================= */
import { json, route } from '../../../_lib/http.js';
import { requireUser, unlinkGoogle, signInMethods } from '../../../_lib/auth.js';

export default route({
  async POST(req, res) {
    const user = await requireUser(req, res);
    await unlinkGoogle(user.id);
    json(res, 200, { ok: true, methods: await signInMethods(user.id) });
  },
});
