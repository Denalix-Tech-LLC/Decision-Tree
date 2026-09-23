/* DELETE /api/auth/account — close the account and delete everything on it.

   Two gates, because this is the one irreversible action in the API: proof
   that it is the owner (the password, or for an account with no password —
   one made through Google — a sign-in within the last ten minutes), and the
   literal word DELETE. The client asks for both in a dialog that names what
   is about to go and how much of it there is. The password check goes
   through the same throttle as signing in.
   ========================================================================= */
import { bad, json, readJson, route } from '../../_lib/http.js';
import { requireUser, requireRecentAuth, deleteAccount, clearSessionCookie } from '../../_lib/auth.js';
import { counts } from '../../_lib/records.js';

export default route({
  async DELETE(req, res) {
    const user = await requireUser(req, res);
    const body = (await readJson(req)) || {};

    if (String(body.confirm || '').trim().toUpperCase() !== 'DELETE') {
      throw bad('confirm_required', 'Type DELETE to confirm. This cannot be undone.', {
        fields: { confirm: 'Type DELETE to confirm.' },
      });
    }
    await requireRecentAuth(req, user, { password: String(body.password || ''), field: 'password' });

    const had = await counts(user.id);
    await deleteAccount(user.id);
    clearSessionCookie(req, res);
    json(res, 200, { ok: true, deleted: had });
  },
});
