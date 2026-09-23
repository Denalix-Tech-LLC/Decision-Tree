/* POST /api/auth/password — change the password, or set the first one on an
   account that arrived through Google.

   Proof first (requireRecentAuth): the current password in `current`, or a
   sign-in within the last ten minutes. Without that, anyone holding a
   borrowed session could set a password on a Google-only account and keep a
   way in after the owner signs out — or change the owner's.

   Then every session on the account ends, THIS one included, and this
   browser gets a new token. The usual reason for changing a password is that
   someone else may know the old one; leaving their session alive, or the
   token that may itself be what leaked, defeats the change. There is no
   opt-out.
   ========================================================================= */
import { bad, json, readJson, route } from '../../_lib/http.js';
import {
  requireUser,
  requireRecentAuth,
  setPassword,
  replaceSessions,
  checkPassword,
} from '../../_lib/auth.js';

export default route({
  async POST(req, res) {
    const user = await requireUser(req, res);
    const body = (await readJson(req)) || {};
    const next = String(body.password || '');
    /* The strength rules first: they reveal nothing, and a person should fix
       the new password before being asked to prove anything again. */
    const weak = checkPassword(next, { email: user.email, name: user.name });
    if (weak) throw bad('weak_password', weak, { fields: { password: weak } });

    const proof = await requireRecentAuth(req, user, {
      password: String(body.current || ''),
      field: 'current',
    });
    await setPassword(user.id, next);
    /* A password typed just now is a fresh proof; a recent sign-in keeps the
       time it already had, so this cannot be used to extend it. */
    await replaceSessions(req, res, user, {
      authedAt: proof === 'password' ? new Date() : user.authedAt,
    });
    json(res, 200, { ok: true, signedOutOthers: true });
  },
});
