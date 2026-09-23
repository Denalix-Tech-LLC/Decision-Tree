/* GET /api/auth/google/start?next=/work — begin the Google sign-in.

   A browser navigation, not a fetch: this answers with a redirect to Google,
   having first stored the flow server-side (oauth_flows) and given the
   browser a cookie holding nothing but the random id of that row.

   ?link=1 attaches a Google identity to the account already signed in,
   rather than signing in as whoever the Google account turns out to be.
   Adding a way in is a sensitive change, so it needs a sign-in within the
   last ten minutes; without one the browser goes back where it came from
   with ?signin=reauth, and the page there asks the person to confirm who
   they are. The session that asked is recorded with the flow, and the
   callback attaches only to that same session.
   ========================================================================= */
import { route, redirect, errorPage, setCookie, isSecureRequest, queryOf } from '../../../_lib/http.js';
import {
  isGoogleEnabled,
  authorizeUrl,
  randomToken,
  saveFlow,
  safeNext,
  flowCookieName,
  FLOW_TTL_SECONDS,
} from '../../../_lib/google.js';
import { currentUser, isRecentlyAuthed } from '../../../_lib/auth.js';
import { isConfigured } from '../../../_lib/db.js';

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
    const next = safeNext(q.next);
    const wantsLink = q.link === '1' || q.link === 'true';

    let sessionId = null;
    if (wantsLink) {
      const me = await currentUser(req, res);
      if (me) {
        if (!isRecentlyAuthed(me)) {
          return redirect(res, next + (next.includes('?') ? '&' : '?') + 'signin=reauth');
        }
        sessionId = me.sessionId;
      }
      /* Nobody signed in: there is nothing to attach to, so this is an
         ordinary sign-in and the callback treats it as one. */
    }

    const state = randomToken();
    const nonce = randomToken();
    const id = await saveFlow({ state, nonce, next, link: !!sessionId, sessionId });
    setCookie(res, flowCookieName(req), id, {
      /* Ten minutes is longer than anyone takes to pick an account and
         shorter than a cookie worth stealing. Lax, because the browser comes
         back from accounts.google.com by top-level navigation. */
      maxAge: FLOW_TTL_SECONDS,
      httpOnly: true,
      secure: isSecureRequest(req),
      sameSite: 'Lax',
    });
    redirect(res, authorizeUrl({ req, state, nonce }));
  },
});
