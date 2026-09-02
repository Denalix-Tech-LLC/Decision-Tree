/* DELETE /api/auth/account — close the account and delete everything on it.

   Two gates, because this is the one irreversible action in the API: the
   current password, and the literal word DELETE. The client asks for both in
   a dialog that names what is about to go and how much of it there is.
   ========================================================================= */
import { bad, json, readJson, route } from '../_lib/http.js';
import { requireUser, verifyPassword, deleteAccount, clearSessionCookie } from '../_lib/auth.js';
import { one } from '../_lib/db.js';
import { counts } from '../_lib/records.js';

export default route({
  async DELETE(req, res) {
    const user = await requireUser(req, res);
    const body = await readJson(req);

    if (String(body.confirm || '').trim().toUpperCase() !== 'DELETE') {
      throw bad('confirm_required', 'Type DELETE to confirm. This cannot be undone.', {
        fields: { confirm: 'Type DELETE to confirm.' },
      });
    }
    const row = await one('select password_hash from users where id = $1', [user.id]);
    const ok = row && (await verifyPassword(String(body.password || ''), row.password_hash));
    if (!ok) {
      throw bad('wrong_password', 'That is not your password.', {
        fields: { password: 'That is not your password.' },
      });
    }

    const had = await counts(user.id);
    await deleteAccount(user.id);
    clearSessionCookie(req, res);
    json(res, 200, { ok: true, deleted: had });
  },
});
