/* POST /api/auth/register — make an account and sign in with it. */
import { json, readJson, route, str } from '../_lib/http.js';
import {
  createUser,
  createSession,
  publicUser,
  attemptBuckets,
  throttle,
  recordAttempt,
  checkEmail,
  checkPassword,
} from '../_lib/auth.js';

export default route({
  async POST(req, res) {
    const body = await readJson(req);
    const email = str(body.email, { max: 254 });
    const name = str(body.name, { max: 120 });
    const password = String(body.password || '');

    /* Registering is rate-limited on the same buckets as signing in, so the
       endpoint cannot be used to enumerate addresses at speed either. */
    const buckets = attemptBuckets(req, email);
    await throttle(buckets);

    const fields = {};
    const e = checkEmail(email);
    if (e) fields.email = e;
    const p = checkPassword(password, { email, name });
    if (p) fields.password = p;
    if (Object.keys(fields).length) {
      await recordAttempt(buckets, false);
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
      await recordAttempt(buckets, false);
      throw err;
    }
    await recordAttempt(buckets, true);
    await createSession(req, res, user.id);
    json(res, 201, {
      user: publicUser({
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.created_at,
      }),
    });
  },
});
