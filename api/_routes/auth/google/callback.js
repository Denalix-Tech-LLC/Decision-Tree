/* GET /api/auth/google/callback — where Google sends the browser back.

   Everything here is checked before a session is created: the state cookie
   this flow wrote, the code Google returned, the claims inside the id_token,
   and the nonce tying that token to this attempt. On success the browser is
   sent back to the page it started from; on failure it gets a plain page
   saying what went wrong, because a person is looking at it.
   ========================================================================= */
import {
  route,
  redirect,
  errorPage,
  setCookie,
  isSecureRequest,
  parseCookies,
  queryOf,
} from '../../../_lib/http.js';
import {
  isGoogleEnabled,
  exchangeCode,
  readIdToken,
  unpackFlow,
  safeNext,
} from '../../../_lib/google.js';
import { findOrCreateGoogleUser, createSession, currentUser, linkGoogle } from '../../../_lib/auth.js';
import { isConfigured } from '../../../_lib/db.js';
import { FLOW_COOKIE } from './start.js';

function clearFlow(req, res) {
  setCookie(res, FLOW_COOKIE, '', {
    maxAge: 0,
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'Lax',
  });
}

export default route({
  async GET(req, res) {
    const q = queryOf(req);
    const flow = unpackFlow(parseCookies(req)[FLOW_COOKIE]);
    clearFlow(req, res);

    if (!isConfigured() || !isGoogleEnabled()) {
      return errorPage(
        res,
        503,
        'Google sign-in is not set up here',
        'This deployment is not configured for it. You can still use the tool, and sign in with an email address and a password if the deployment has storage.'
      );
    }

    /* The person pressed Cancel, or Google refused. Not an error worth a
       stack trace — put them back where they were. */
    if (q.error) {
      const back = safeNext(flow && flow.next);
      return redirect(res, back + (back.includes('?') ? '&' : '?') + 'signin=cancelled');
    }
    if (!flow || !flow.s || !q.state) {
      return errorPage(
        res,
        400,
        'That sign-in could not be completed',
        'The page that started it is no longer the one finishing it — the browser may have blocked the cookie, or it may simply have taken too long. Go back and try again.'
      );
    }
    if (String(q.state) !== String(flow.s)) {
      return errorPage(
        res,
        400,
        'That sign-in did not match',
        'The reply did not match the request this browser made, so it was refused. Go back and start again.'
      );
    }
    if (!q.code) {
      return errorPage(
        res,
        400,
        'Google sent no sign-in back',
        'There was nothing in the reply to sign you in with. Go back and try again.'
      );
    }

    try {
      const tokens = await exchangeCode(req, String(q.code));
      const profile = readIdToken(tokens.id_token, { nonce: flow.n });
      const back = safeNext(flow.next);
      const sep = back.includes('?') ? '&' : '?';

      /* Attaching Google to the account already signed in. If the session has
         gone in the meantime, fall through and treat it as an ordinary
         sign-in rather than losing the trip to Google. */
      if (flow.link) {
        const me = await currentUser(req, res);
        if (me) {
          await linkGoogle(me.id, profile);
          return redirect(res, back + sep + 'signin=attached');
        }
      }

      const user = await findOrCreateGoogleUser(profile);
      await createSession(req, res, user.id);
      const mark = user.created ? 'new' : user.linked ? 'linked' : 'google';
      redirect(res, back + sep + 'signin=' + mark);
    } catch (err) {
      if (err.code === 'google_taken') {
        return errorPage(
          res,
          409,
          'That Google account is already in use here',
          err.message + ' Sign in as that account instead, or attach a different one.'
        );
      }
      console.error('[google] sign-in failed:', err.code || '', err.message);
      const known = err.code === 'google_rejected' || err.code === 'google_bad_token';
      errorPage(
        res,
        known ? 400 : 502,
        'That Google sign-in did not work',
        known
          ? err.message
          : 'Google could not be reached, or would not complete the sign-in. Nothing has changed on your account. Try again in a moment.'
      );
    }
  },
});
