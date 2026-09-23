/* POST /api/auth/register — make an account and sign in with it.

   The address is taken as typed and is NOT verified by this: nothing here
   proves the person owns it. That matters for exactly one address — the one
   in ADMIN_EMAIL — and the editor gate asks for proof separately (see
   requireEditor in auth.js).

   Throttled two ways (registerBuckets): failed attempts count against the
   client's address like failed sign-ins, and successful ones are limited to
   a few an hour per address, so one client cannot mint accounts to fill the
   database. Failures do not count against the address being registered, so
   nobody can lock a named person out by failing to register their address.

   A database past its ceiling (TAS_DB_BYTES, see records.js) takes no new
   accounts either: each one is a row, and the point of the ceiling is that
   the space left stays with the people already here, whose sign-ins still
   work. Checked before the throttle, so a refusal for space is not counted
   as a failed attempt against the client's address. */
import { json, readJson, route, str, storageFull } from '../../_lib/http.js';
import { databaseFull } from '../../_lib/records.js';
import {
  createUser,
  createSession,
  endPresentedSession,
  publicUser,
  registerBuckets,
  reserveAttempt,
  settleAttempt,
  checkEmail,
  checkPassword,
} from '../../_lib/auth.js';

export default route({
  async POST(req, res) {
    const body = (await readJson(req)) || {};
    const email = str(body.email, { max: 254 });
    const name = str(body.name, { max: 120 });
    const password = String(body.password || '');

    if (await databaseFull()) {
      throw storageFull(
        'This deployment has run out of room for new accounts. Existing accounts can still ' +
          'sign in. The site owner needs to clear space (npm run db:prune) or raise TAS_DB_BYTES.'
      );
    }

    const ticket = await reserveAttempt(registerBuckets(req));

    const fields = {};
    const e = checkEmail(email);
    if (e) fields.email = e;
    const p = checkPassword(password, { email, name });
    if (p) fields.password = p;
    if (Object.keys(fields).length) {
      await settleAttempt(ticket, false);
      json(res, 400, {
        error: 'invalid',
        message: 'Check the fields marked below.',
        fields,
      });
      return;
    }

    let user;
    try {
      user = await createUser({ email, name, password });
    } catch (err) {
      await settleAttempt(ticket, false);
      throw err;
    }
    await settleAttempt(ticket, true);
    await endPresentedSession(req);
    await createSession(req, res, user.id);
    json(res, 201, {
      user: publicUser({
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.created_at,
        emailVerified: user.email_verified === true,
      }),
    });
  },
});
