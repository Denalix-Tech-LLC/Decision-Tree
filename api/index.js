/* ===========================================================================
   THE SAME DISPATCHER, REACHED A SECOND WAY

   api/[...route].js is a catch-all, and on this deployment Vercel matched it
   for ONE path segment only: /api/health and /api/tree arrived, while
   /api/auth/me and /api/auth/login came back as the platform's own NOT_FOUND
   without ever reaching a function. Health looked perfect and every sign-in
   endpoint was dead, because all of those live two segments deep.

   So vercel.json rewrites /api/(.*) to /api?route=$1, which lands here. A
   rewrite in vercel.json is a FALLBACK — it is consulted only when nothing in
   the filesystem matched — so paths the catch-all is already serving keep
   going straight there, and this picks up the ones it drops. Whichever of the
   two answers, the request ends up in the same handler with the same table.

   The path arrives as ?route=auth/me, a single string with slashes; the
   handler splits on '/' and also falls back to req.url, so it does not much
   matter which way it came in.
   ========================================================================= */
export { default } from './[...route].js';
