/* POST /api/auth/password — change the password.

   Every other session is ended by default: the usual reason for changing a
   password is that someone else may know the old one, and leaving their
   session alive defeats the change. `keepOtherSessions: true` opts out.
   ========================================================================= */
import { json, readJson, route } from '../_lib/http.js';
import { requireUser, changePassword, endAllSessions } from '../_lib/auth.js';

export default route({
  async POST(req, res) {
    const user = await requireUser(req, res);
    const body = await readJson(req);
    await changePassword(user.id, String(body.current || ''), String(body.password || ''));
    let signedOutOthers = false;
    if (body.keepOtherSessions !== true) {
      await endAllSessions(user.id, user.sessionId);
      signedOutOthers = true;
    }
    json(res, 200, { ok: true, signedOutOthers });
  },
});
