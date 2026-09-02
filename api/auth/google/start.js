/* GET /api/auth/google/start?next=/work — begin the Google sign-in.

   A browser navigation, not a fetch: this answers with a redirect to Google,
   having first written the one cookie that makes the callback trustworthy.
   ========================================================================= */
import { route, redirect, errorPage, setCookie, isSecureRequest, queryOf } from '../../_lib/http.js';
import {
  isGoogleEnabled,
  authorizeUrl,
  randomToken,
  packFlow,
  safeNext,
} from '../../_lib/google.js';
import { isConfigured } from '../../_lib/db.js';

export const FLOW_COOKIE = 'tas_oauth';

export default route({
  async GET(req, res) {
    if (!isConfigured()) {
      return errorPage(
        res,
        503,
        'Signing in is not set up here',
        'This deployment has no database behind it, so it has no accounts. Everything else in the tool works.'
      );
    }
    if (!isGoogleEnabled()) {
      return errorPage(
        res,
        503,
        'Google sign-in is not set up here',
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured on this deployment. You can still sign in with an email address and a password.'
      );
    }
    const q = queryOf(req);
    const state = randomToken();
    const nonce = randomToken();
    const next = safeNext(q.next);
    /* ?link=1 attaches a Google identity to the account already signed in,
       rather than signing in as whoever the Google account turns out to be.
       The callback reads this and takes the other path. */
    const link = q.link === '1' || q.link === 'true';
    setCookie(res, FLOW_COOKIE, packFlow({ s: state, n: nonce, next, link }), {
      /* Ten minutes is longer than anyone takes to pick an account and
         shorter than a cookie worth stealing. Lax, because the browser comes
         back from accounts.google.com by top-level navigation. */
      maxAge: 600,
      httpOnly: true,
      secure: isSecureRequest(req),
      sameSite: 'Lax',
    });
    redirect(res, authorizeUrl({ req, state, nonce }));
  },
});
