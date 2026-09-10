/* POST /api/auth/logout — end this session. Signing out of a shared machine
   has to work even when the session is already gone, so this never fails. */
import { json, route } from '../../_lib/http.js';
import { currentUser, endSession, clearSessionCookie } from '../../_lib/auth.js';

export default route({
  async POST(req, res) {
    let user = null;
    try {
      user = await currentUser(req, res);
    } catch {
      /* an unreachable database must not leave a browser signed in */
    }
    if (user) {
      try {
        await endSession(user.sessionId);
      } catch {
        /* the cookie goes regardless; a session row nobody can present is
           harmless and expires on its own */
      }
    }
    clearSessionCookie(req, res);
    json(res, 200, { ok: true });
  },
});
