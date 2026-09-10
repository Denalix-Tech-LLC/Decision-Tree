/* POST /api/auth/login — exchange email and password for a session cookie. */
import { json, readJson, route, str } from '../../_lib/http.js';
import {
  authenticate,
  createSession,
  publicUser,
  attemptBuckets,
  throttle,
  recordAttempt,
} from '../../_lib/auth.js';

export default route({
  async POST(req, res) {
    const body = await readJson(req);
    const email = str(body.email, { max: 254 });
    const password = String(body.password || '');

    const buckets = attemptBuckets(req, email);
    await throttle(buckets);

    const out = email && password ? await authenticate(email, password) : { reason: 'bad_credentials' };
    if (out.reason === 'google_only') {
      await recordAttempt(buckets, false);
      json(res, 409, {
        error: 'use_google',
        message:
          'That account signs in with Google — use the Google button. ' +
          'You can add a password afterwards under Account settings.',
      });
      return;
    }
    if (!out.user) {
      await recordAttempt(buckets, false);
      /* One message for a wrong password and for an address with no account.
         Saying which would turn this endpoint into a directory of who has an
         account on a Tribe's tool. */
      json(res, 401, {
        error: 'bad_credentials',
        message: 'That email address and password do not match an account.',
      });
      return;
    }
    await recordAttempt(buckets, true);
    await createSession(req, res, out.user.id);
    json(res, 200, { user: publicUser(out.user) });
  },
});
