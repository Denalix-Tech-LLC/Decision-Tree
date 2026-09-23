/* GET /api/auth/google/callback — where Google sends the browser back.

   Everything here is checked before a session is created: the flow this
   browser's cookie names (taken from oauth_flows and deleted in the same
   statement, so it completes at most once), the state Google returned
   against the one stored with it, the code, the claims inside the id_token,
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
  takeFlow,
  sameState,
  safeNext,
  flowCookieName,
} from '../../../_lib/google.js';
import {
  findOrCreateGoogleUser,
  createSession,
  endPresentedSession,
  currentUser,
  linkGoogle,
  endAllSessions,
} from '../../../_lib/auth.js';
import { isConfigured } from '../../../_lib/db.js';

function clearFlow(req, res) {
  setCookie(res, flowCookieName(req), '', {
    maxAge: 0,
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'Lax',
  });
}

export default route({
  async GET(req, res) {
    const q = queryOf(req);
    const flowId = parseCookies(req)[flowCookieName(req)];
    clearFlow(req, res);

    if (!isConfigured() || !isGoogleEnabled()) {
      return errorPage(
        res,
        503,
        'Google sign-in is not set up here',
        'This deployment is not configured for it. You can still use the tool, and sign in with an email address and a password if the deployment has storage.'
      );
    }

    /* Spent whatever happens next: a flow is good for one reply. */
    const flow = flowId ? await takeFlow(flowId) : null;

    /* The person pressed Cancel, or Google refused. Not an error worth a
       stack trace — put them back where they were. */
    if (q.error) {
      const back = safeNext(flow && flow.next);
      return redirect(res, back + (back.includes('?') ? '&' : '?') + 'signin=cancelled');
    }
    if (!flow || !q.state) {
      return errorPage(
        res,
        400,
        'That sign-in could not be completed',
        'The page that started it is no longer the one finishing it — the browser may have blocked the cookie, it may have taken more than ten minutes, or this reply was already used. Go back and try again.'
      );
    }
    if (!sameState(q.state, flow.state)) {
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
      const profile = readIdToken(tokens.id_token, { nonce: flow.nonce });
      const back = safeNext(flow.next);
      const sep = back.includes('?') ? '&' : '?';

      /* Attaching Google to the account that asked — and only to the very
         session that asked, which start.js has already required to be a
         recent sign-in. Any other browser on the account is signed out: a
         way in has just been added, and the owner should not have to wonder
         who else is still in. If that session has gone in the meantime, fall
         through and treat it as an ordinary sign-in rather than losing the
         trip to Google. */
      if (flow.link && flow.sessionId) {
        const me = await currentUser(req, res);
        if (me && me.sessionId === flow.sessionId) {
          await linkGoogle(me.id, profile);
          await endAllSessions(me.id, me.sessionId);
          return redirect(res, back + sep + 'signin=attached');
        }
      }

      const user = await findOrCreateGoogleUser(profile);
      /* The browser's previous session, if any, is replaced rather than left
         valid beside the new one (see endPresentedSession). */
      await endPresentedSession(req);
      await createSession(req, res, user.id);
      const mark = user.created ? 'new' : user.linked ? 'linked' : 'google';
      redirect(res, back + sep + 'signin=' + mark);
    } catch (err) {
      if (err.code === 'google_taken' || err.code === 'google_conflict') {
        return errorPage(
          res,
          409,
          err.code === 'google_taken'
            ? 'That Google account is already in use here'
            : 'A different Google account is attached',
          err.message +
            (err.code === 'google_taken'
              ? ' Sign in as that account instead, or attach a different one.'
              : ' Sign in with that one or with the password, and change it under Account settings.')
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
