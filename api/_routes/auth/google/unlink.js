/* POST /api/auth/google/unlink — detach the Google account from this one.

   Refused when it is the only way in: an account nobody can sign in to is a
   deleted account with extra steps, and deleting is a decision someone should
   make on purpose, in the dialog that says what goes with it.

   Removing a way in is sensitive, so it needs the password in `password` or
   a sign-in within the last ten minutes. Afterwards every OTHER session on
   the account ends: one of them may have been made through the Google
   account that has just been detached, and it should not outlive it.
   ========================================================================= */
import { bad, json, readJson, route } from '../../../_lib/http.js';
import {
  requireUser,
  requireRecentAuth,
  unlinkGoogle,
  signInMethods,
  endAllSessions,
} from '../../../_lib/auth.js';

export default route({
  async POST(req, res) {
    const user = await requireUser(req, res);
    const body = (await readJson(req)) || {};
    /* A change that cannot happen is refused before anyone is asked to prove
       who they are for it. unlinkGoogle checks again, after the proof. */
    const has = await signInMethods(user.id);
    if (!has.google) throw bad('not_linked', 'No Google account is attached to this one.');
    if (!has.password) {
      throw bad(
        'last_method',
        'Set a password first — otherwise removing Google would leave no way to sign in.'
      );
    }
    await requireRecentAuth(req, user, { password: String(body.password || '') });
    await unlinkGoogle(user.id);
    await endAllSessions(user.id, user.sessionId);
    json(res, 200, { ok: true, signedOutOthers: true, methods: await signInMethods(user.id) });
  },
});
