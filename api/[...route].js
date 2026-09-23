/* ===========================================================================
   THE ONLY SERVERLESS FUNCTION
   Vercel turns every file under api/ into its own function, and the Hobby
   plan allows twelve. This project had eighteen routes, so a deployment was
   refused outright. It has twenty now.

   The routes themselves did not need to change: they moved to api/_routes/,
   where the leading underscore keeps Vercel from counting them, and this
   catch-all dispatches to them. One function, twenty endpoints, and the
   URLs the client calls are exactly what they were.

   Why the table below is written out by hand rather than resolved from disk:
   Vercel bundles a function by following its imports statically. An
   `import(someComputedPath)` is invisible to that, so the route modules would
   be left out of the bundle and every endpoint would 404 in production while
   working perfectly on a laptop. Every route is therefore a real static
   import, and the table is the routing.

   The dev server still walks api/_routes from disk, because that is what lets
   a route file be edited without a restart. The two agreeing is not left to
   chance — scripts/selftest.mjs compares this table against what the walk
   finds and fails if either grows a route the other has not heard of.
   ========================================================================= */
import { json } from './_lib/http.js';

import health from './_routes/health.js';
import tree from './_routes/tree.js';

import authAccount from './_routes/auth/account.js';
import authLogin from './_routes/auth/login.js';
import authLogout from './_routes/auth/logout.js';
import authMe from './_routes/auth/me.js';
import authPassword from './_routes/auth/password.js';
import authRegister from './_routes/auth/register.js';
import authSessions from './_routes/auth/sessions.js';

import googleCallback from './_routes/auth/google/callback.js';
import googleStart from './_routes/auth/google/start.js';
import googleUnlink from './_routes/auth/google/unlink.js';

import treesIndex from './_routes/trees/index.js';
import treesItem from './_routes/trees/[id].js';
import runsIndex from './_routes/runs/index.js';
import runsItem from './_routes/runs/[id].js';
import documentsIndex from './_routes/documents/index.js';
import documentsItem from './_routes/documents/[id].js';
import mediaIndex from './_routes/media/index.js';
import mediaItem from './_routes/media/[hash].js';

/* path after /api/ → handler */
export const STATIC_ROUTES = {
  health,
  tree,
  'auth/account': authAccount,
  'auth/login': authLogin,
  'auth/logout': authLogout,
  'auth/me': authMe,
  'auth/password': authPassword,
  'auth/register': authRegister,
  'auth/sessions': authSessions,
  'auth/google/callback': googleCallback,
  'auth/google/start': googleStart,
  'auth/google/unlink': googleUnlink,
  trees: treesIndex,
  runs: runsIndex,
  documents: documentsIndex,
  media: mediaIndex,
};

/* collections whose last segment is a record id, matching the [param].js
   files — [id] for saved work, [hash] for an uploaded image */
export const ITEM_ROUTES = {
  trees: { param: 'id', handler: treesItem },
  runs: { param: 'id', handler: runsItem },
  documents: { param: 'id', handler: documentsItem },
  media: { param: 'hash', handler: mediaItem },
};

/* Resolve the way the file tree would: an exact name wins, and only then does
   the last segment get read as a [param]. Exported so the selftest can drive
   it directly. */
export function resolveRoute(segments) {
  if (!segments.length) return null;
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || seg.startsWith('_')) return null;
  }
  const key = segments.join('/');
  if (Object.prototype.hasOwnProperty.call(STATIC_ROUTES, key)) {
    return { handler: STATIC_ROUTES[key], params: {} };
  }
  if (segments.length >= 2) {
    const parent = segments.slice(0, -1).join('/');
    const item = Object.prototype.hasOwnProperty.call(ITEM_ROUTES, parent)
      ? ITEM_ROUTES[parent]
      : null;
    if (item) {
      return { handler: item.handler, params: { [item.param]: segments[segments.length - 1] } };
    }
  }
  return null;
}

export default async function handler(req, res) {
  /* Vercel hands the matched segments over in req.query under the name of the
     catch-all. A single deep string arrives from some runtimes, so both shapes
     are accepted; the URL itself is the fallback, which is also what makes
     this callable from the dev server. */
  const q = req.query || {};
  let segments = q.route;
  if (typeof segments === 'string') segments = segments.split('/');
  if (!Array.isArray(segments)) {
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      pathname = String(req.url || '');
    }
    segments = pathname.replace(/^\/api\/?/, '').split('/');
  }
  segments = segments.map((s) => String(s)).filter(Boolean);

  const hit = resolveRoute(segments);
  if (!hit) {
    json(res, 404, { error: 'not_found', message: 'No such endpoint.' });
    return;
  }

  /* The [id] segment reaches the route the same way it always did — through
     req.query — so nothing downstream knows it was dispatched rather than
     matched by a filename. `route` itself is dropped: no endpoint reads it,
     and leaving it in a query a route forwards would be a surprise. */
  const query = { ...q, ...hit.params };
  delete query.route;
  req.query = query;

  await hit.handler(req, res);
}
