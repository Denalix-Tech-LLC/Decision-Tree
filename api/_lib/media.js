/* ===========================================================================
   UPLOADED IMAGES
   One use today: the backdrop photograph, chosen at /admin and shown behind
   the tree to every reader. That is what makes this worth being careful
   about. An image here is served from this origin, to everyone, as the
   background of a page that holds people's accounts.

   So nothing the uploader says is believed. The Content-Type header is a
   claim; the first bytes are evidence. JPEG, PNG and WebP each open with a
   fixed signature, and a file that does not is refused whatever it is
   labelled — SVG above all, which is an image format that can carry script,
   and which a browser will run if it is ever opened as a page of its own.
   The type stored and served back is the sniffed one.

   Images are addressed by the SHA-256 of their bytes. The same photograph
   uploaded twice is one row, and a URL can be cached for a year because the
   thing it names cannot change underneath it.
   ========================================================================= */
import crypto from 'node:crypto';
import { one, tx } from './db.js';
import { bad, tooLarge, storageFull } from './http.js';
import { databaseFull } from './records.js';

export const MAX_IMAGE_BYTES = 3_000_000;
/* A few hundred backdrops is years of changing one's mind. The ceiling is
   what stops a script with the editor's session from filling the database. */
const MAX_IMAGES = 500;
/* ...and the count alone is not enough: 500 images of 3 MB each is 1.5 GB,
   three times what a free Neon or Vercel Postgres project holds, and when
   that project is full every write fails for every account, not just the
   uploads. So there is a ceiling on the bytes as well. 25 MB is dozens of
   well-compressed photographs; a deployment on a bigger database can raise
   it with TAS_MEDIA_BYTES. Read on every upload, so a changed setting
   applies without a redeploy of the code. */
const MEDIA_BYTES_DEFAULT = 25_000_000;
function mediaBudget() {
  const n = Number(process.env.TAS_MEDIA_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : MEDIA_BYTES_DEFAULT;
}
/* Transaction-scoped advisory lock for the ceiling check. One key for the
   whole table, because the ceiling is for the whole table. A single bigint
   key, like ensureSchema's (727_144_001) and distinct from it. */
const MEDIA_LOCK = 727_144_003;
export const HASH_RE = /^[a-f0-9]{64}$/;

const DECLARED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/* The type the bytes say they are, or null. */
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

const REFUSED =
  'That file is not a JPEG, PNG or WebP image, so it cannot be used. ' +
  'Save it in one of those formats and try again.';

/* The declared type has to be one of the three before the bytes are even
   looked at, so an upload labelled image/svg+xml is refused for what it
   claims to be as well as for what it is. A declared type that disagrees
   with the sniffed one — a PNG saved with a .jpg name, which is common and
   harmless — is not refused: the bytes decide, and the bytes are what is
   stored. */
export function checkImage(contentType, buf) {
  const declared = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!DECLARED.has(declared)) throw bad('bad_image', REFUSED);
  if (!buf || !buf.length) throw bad('bad_image', 'The upload was empty. Choose an image and try again.');
  const mime = sniff(buf);
  if (!mime) throw bad('bad_image', REFUSED);
  return mime;
}

export async function storeImage(buf, mime, userId) {
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const budget = mediaBudget();
  /* Asked before the transaction (see records.js databaseFull); acted on
     only once it is known the image is new. */
  const full = await databaseFull();
  /* The check and the insert under one lock, in one transaction. A single
     "insert … where (select count(*) …) < n" is not enough on its own: at
     READ COMMITTED two uploads running at once each count the table as it
     was before either of them, and both go in. */
  return tx(async (client) => {
    await client.query('select pg_advisory_xact_lock($1)', [MEDIA_LOCK]);
    /* The image already being there is success, and must stay success even
       once a ceiling is reached: re-choosing a backdrop that is already
       uploaded costs nothing. */
    const existing = await client.query(`select mime, size from media where hash = $1`, [hash]);
    if (existing.rows[0]) {
      return { hash, mime: existing.rows[0].mime, size: existing.rows[0].size };
    }
    const used = (
      await client.query(
        `select count(*)::int as n, coalesce(sum(size), 0)::bigint as bytes from media`
      )
    ).rows[0];
    if (full) throw storageFull();
    const prune = 'Unused ones can be cleared with `npm run db:prune -- --media`.';
    if (used.n >= MAX_IMAGES) {
      throw tooLarge(
        `There are ${MAX_IMAGES} uploaded images already, which is the limit. ${prune}`,
        'limit_reached'
      );
    }
    if (Number(used.bytes) + buf.length > budget) {
      throw tooLarge(
        `Uploaded images already take ${mb(Number(used.bytes))} of the ${mb(budget)} this ` +
          `deployment allows, and this one is ${mb(buf.length)}. ${prune}`,
        'limit_reached'
      );
    }
    /* "on conflict do nothing" still, for a database shared with a process
       that does not take this lock (an older deployment mid-rollout). */
    const inserted = await client.query(
      `insert into media (hash, mime, bytes, size, created_by)
       values ($1, $2, $3, $4, $5)
       on conflict (hash) do nothing
       returning mime, size`,
      [hash, mime, buf, buf.length, userId || null]
    );
    const row = inserted.rows[0] || { mime, size: buf.length };
    return { hash, mime: row.mime, size: row.size };
  });
}

function mb(n) {
  return (n / 1_000_000).toFixed(1) + ' MB';
}

export async function loadImage(hash) {
  return one(`select mime, bytes, size from media where hash = $1`, [hash]);
}
