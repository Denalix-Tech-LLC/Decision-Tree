/* GET /api/media/<hash>   the bytes of an uploaded image

   Public and sessionless, like GET /api/tree: the backdrop is part of the
   page every reader is served, and a guest's page must not depend on an
   account. Nothing about the answer varies by who asks.

   The headers are most of what this file is for:

     Cache-Control  a year, immutable. The URL is the hash of the bytes, so
                    what it names can never change; a new photograph is a new
                    URL. vercel.json exempts this path from the no-store rule
                    the rest of /api gets, or that would silently win.
     ETag           the hash itself, so a revalidation is a 304 without a
                    database read.
     nosniff, CSP   belt and braces on top of the upload's own sniffing. Even
                    if something that is not an image got in, a browser told
                    it is image/jpeg will not reinterpret it, and opened
                    directly it runs in a sandbox that may load nothing.
     CORP           same-origin: this deployment's pages may use it, nobody
                    else's may hotlink it.
   ========================================================================= */
import { route, notFound, queryOf } from '../../_lib/http.js';
import { isConfigured } from '../../_lib/db.js';
import { HASH_RE, loadImage } from '../../_lib/media.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';

function cacheHeaders(res, hash) {
  res.setHeader('Cache-Control', IMMUTABLE);
  /* Vercel's CDN keeps a function's answer only when told to in a header of
     its own; without this every reader's first visit would read the bytes
     out of Postgres. Safe for the same reason the browser cache is: the
     answer is the same for everyone and cannot change. */
  res.setHeader('CDN-Cache-Control', IMMUTABLE);
  res.setHeader('ETag', '"' + hash + '"');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

/* If-None-Match can be a list, can be weak, and can be "*". */
function matches(header, hash) {
  if (!header) return false;
  return String(header)
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === '"' + hash + '"');
}

async function serve(req, res) {
  const hash = String(queryOf(req).hash || '');
  if (!HASH_RE.test(hash)) throw notFound('No such image.');
  /* The ETag is the content hash, so a client holding this ETag holds these
     exact bytes: it can be told so without asking the database. */
  if (matches(req.headers['if-none-match'], hash)) {
    cacheHeaders(res, hash);
    res.statusCode = 304;
    res.end();
    return;
  }
  if (!isConfigured()) throw notFound('No such image.');
  const row = await loadImage(hash);
  if (!row) throw notFound('No such image.');
  const bytes = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes);
  res.statusCode = 200;
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Content-Length', String(bytes.length));
  cacheHeaders(res, hash);
  /* Node discards the body of a HEAD response by itself. */
  res.end(bytes);
}

export default route({ GET: serve, HEAD: serve });
