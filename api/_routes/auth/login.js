/* POST /api/auth/login — exchange email and password for a session cookie.

   The attempt is reserved against the throttle BEFORE the password is
   checked (see reserveAttempt in auth.js), so a burst of parallel guesses is
   counted guess by guess instead of all slipping past one count. A session
   made here counts as a fresh sign-in, which is also how the account panel's
   "confirm it is you" step works: it signs in again. */
import { json, readJson, route, str } from '../../_lib/http.js';
import {
  authenticate,
  createSession,
  endPresentedSession,
  publicUser,
  signInBuckets,
  reserveAttempt,
  settleAttempt,
} from '../../_lib/auth.js';

export default route({
  async POST(req, res) {
    const body = (await readJson(req)) || {};
    const email = str(body.email, { max: 254 });
    const password = String(body.password || '');

    const ticket = await reserveAttempt(signInBuckets(req, email));

    let out;
    try {
      out = email && password ? await authenticate(email, password) : { reason: 'bad_credentials' };
    } catch (err) {
      await settleAttempt(ticket, false);
      throw err;
    }
    await settleAttempt(ticket, !!out.user);

    if (out.reason === 'google_only') {
      json(res, 409, {
        error: 'use_google',
        message:
          'That account signs in with Google — use the Google button. ' +
          'You can add a password afterwards under Account settings.',
      });
      return;
    }
    if (!out.user) {
      /* One message for a wrong password and for an address with no account.
         Saying which would turn this endpoint into a directory of who has an
         account on a Tribe's tool. */
      json(res, 401, {
        error: 'bad_credentials',
        message: 'That email address and password do not match an account.',
      });
      return;
    }
    /* The session this browser was carrying (if any) ends here rather than
       living on beside the new one: confirming identity must not leave a
       possibly-leaked token valid for the rest of its lifetime. */
    await endPresentedSession(req);
    await createSession(req, res, out.user.id);
    json(res, 200, { user: publicUser(out.user) });
  },
});
