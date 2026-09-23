/* ===========================================================================
   SAVED WORK
   Three kinds of record, one shape of handler:

     trees      a decision-tree definition — what /admin edits
     runs       a path through a tree — what a reader answered
     documents  a generated result, and then an edited one

   All three are owned by exactly one account, listed newest-first, and deleted
   softly: a delete sets deleted_at and the row stays until someone asks for it
   to be purged. Losing a Council briefing to a mis-click is not recoverable by
   apology, so it is recoverable by design.
   ========================================================================= */
import crypto from 'node:crypto';
import { one, many, tx } from './db.js';
import { bad, notFound, tooLarge, storageFull, str, jsonSize } from './http.js';
import { cleanHtml, cleanUrl, CLASSES } from './markup.js';

/* Per-account ceilings. Generous for real use, low enough that a runaway
   script cannot fill the database.

   The database is the whole of this deployment's storage, and on the tier
   it is meant for (Vercel Postgres, which is Neon's free plan: about half a
   gigabyte) running out of room is not one account's problem — every write
   fails, for everyone, until someone clears space by hand. So these are an
   availability control first:

     count   saved records of each kind, deleted ones included
     bytes   one record of that kind, measured after the filter has run
     total   everything one account holds across all three kinds, deleted
             ones included, measured the same way

   Deleted records count because they are still rows: a delete is soft, and
   a limit that forgot the trash could be walked round by deleting and
   saving again, forever. Purging from Deleted (or `npm run db:prune --
   --trash <days>`) is what makes room. The total can be raised for a
   deployment on a bigger database with TAS_ACCOUNT_BYTES; it is read when
   this module loads. */
const ACCOUNT_BYTES_DEFAULT = 5_000_000;
function accountBytes() {
  const n = Number(process.env.TAS_ACCOUNT_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : ACCOUNT_BYTES_DEFAULT;
}
export const LIMITS = {
  trees: { count: 200, bytes: 1_500_000 },
  runs: { count: 1000, bytes: 400_000 },
  documents: { count: 1000, bytes: 1_000_000 },
  total: { bytes: accountBytes() },
};

/* ...and one ceiling for the whole database. The per-account total stops
   one account filling it; it does not stop many accounts doing so, and
   registration is limited per address, not overall, so a handful of
   addresses opening accounts and filling each could still reach the
   free tier's half gigabyte in a day. When Postgres is out of room every
   INSERT fails — including the session row a sign-in writes — so the
   ceiling sits below that and refuses only new saved work, new images and
   (register.js, if it calls this) new accounts. Sessions, login throttling,
   deletes, purges and edits that make a record no bigger are never refused
   by it, so people can still sign in and clear space.

   TAS_DB_BYTES sets it (default 400 MB, for a 0.5 GB database); read on
   every check. The database's size is asked of Postgres at most once a
   minute per instance: it is a sum over files on disk, cheap but not free,
   and a minute's lag on a ceiling set 100 MB below the real one is
   harmless. If the size cannot be read (a role without CONNECT on the
   database, say) the check lets the write through: this is a guard for
   availability, and a guard that failed closed would itself take saving
   down. */
const DB_BYTES_DEFAULT = 400_000_000;
const DB_SIZE_TTL_MS = 60_000;
function dbBytesCap() {
  const n = Number(process.env.TAS_DB_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DB_BYTES_DEFAULT;
}
let dbSizeSeen = { at: -Infinity, bytes: null };

/* True when the database is over TAS_DB_BYTES. Called outside any
   transaction: a failed query inside one would abort the write it was
   guarding, and the pool may hold only the one connection. */
export async function databaseFull() {
  if (Date.now() - dbSizeSeen.at > DB_SIZE_TTL_MS) {
    let bytes = null;
    try {
      const r = await one('select pg_database_size(current_database())::bigint as n');
      bytes = Number(r && r.n);
      if (!Number.isFinite(bytes)) bytes = null;
    } catch (err) {
      /* Postgres answered and said no (permissions, a function this server
         lacks): let the write through. No database at all, or none that
         can be reached, is left to the write itself to report, as it
         always has. */
      const code = String((err && err.code) || '');
      if (!/^[0-9A-Z]{5}$/.test(code) || /^(08|57)/.test(code)) throw err;
      console.warn('[records] could not read the database size: ' + (err.message || err));
    }
    dbSizeSeen = { at: Date.now(), bytes };
  }
  return dbSizeSeen.bytes !== null && dbSizeSeen.bytes > dbBytesCap();
}

/* What one row costs, in SQL, for the total. The text of every stored
   column a person can fill, as Postgres holds it after the filter has run,
   so the number is the same whichever request put it there. (jsonb's text
   form puts a space after each ":" and ",", so this runs slightly above the
   size of the JSON that was sent: the right side to err on.) */
const ROW_BYTES = {
  trees: `octet_length(data::text) + octet_length(title) + octet_length(note)`,
  runs:
    `octet_length(path::text) + octet_length(collected::text)` +
    ` + coalesce(octet_length(snapshot::text), 0) + octet_length(title) + octet_length(note)` +
    ` + coalesce(octet_length(terminal), 0)`,
  documents:
    `octet_length(body_html) + octet_length(meta::text) + octet_length(title) + octet_length(kind)`,
};

/* The two-key form of a transaction-scoped advisory lock: this constant,
   then a hash of the account id. Two-key locks never collide with the
   one-key ones ensureSchema and media.js take. */
const QUOTA_LOCK = 727_144_002;
/* An id no row has, for "every row the account holds". */
const NO_ROW = '00000000-0000-0000-0000-000000000000';

const KINDS = {
  trees: {
    table: 'trees',
    columns: 'id, user_id, title, note, data, created_at, updated_at, deleted_at',
  },
  runs: {
    table: 'runs',
    columns:
      'id, user_id, tree_id, title, note, path, collected, terminal, snapshot, created_at, updated_at, deleted_at',
  },
  documents: {
    table: 'documents',
    columns:
      'id, user_id, run_id, tree_id, title, kind, body_html, meta, edited, created_at, updated_at, deleted_at',
  },
};

function kindOf(name) {
  const k = KINDS[name];
  if (!k) throw bad('bad_kind', 'Unknown record type.');
  return k;
}

/* ---- shaping ----------------------------------------------------------- */

function plainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

/* A tree definition. The keys are the ones tree-data.js ships; anything else
   is dropped rather than stored, so a saved tree cannot smuggle fields the
   reader will not read. COPY and THEME are here because a key missing from
   this list is not refused, it is silently removed — Publish would have
   reported success and taken every word of the wording with it. */
const TREE_KEYS = [
  'NODES',
  'OUT',
  'NONTAS',
  'CRITERIA',
  'NEXT',
  'LINKS',
  'DISC',
  'CONTACT',
  'GUIDE',
  'COPY',
  'THEME',
];

/* Ceilings on the two lists of screens. Generous beside what ships (ten
   guide sections, five walkthrough screens); low enough that a runaway
   editor cannot make a reader page through hundreds. */
const MAX_GUIDE = 40;
const MAX_WALK = 12;
/* Deeper than anything tree-data.js nests (four or five levels), and shallow
   enough that walking it cannot run the stack out. */
const MAX_DEPTH = 24;
const MAX_STRING = 400_000;

/* ---- the backdrop ------------------------------------------------------

   The same rule as TAS_LOOK.clean in look.js, and it has to stay the same:
   the browser applies what this lets through as a CSS url(), in front of
   every reader. So the photograph is not "a URL that looks safe", it is one
   of exactly three shapes, and anything else becomes the shipped default:

     'land.jpg'                  the photograph the repo ships
     ''                          no photograph; the plain page colour shows
     '/api/media/<sha256 hex>'   an image uploaded through POST /api/media

   An allowlist rather than escaping, because escaping has to be right in
   CSS, in a custom property and in url() at once, and this has to be right
   only here. It also keeps the promise that the page makes no request to
   another origin: no content can point the backdrop anywhere but this
   deployment. */
const THEME_DEFAULT = Object.freeze({
  photo: 'land.jpg',
  position: 56,
  opacityLight: null,
  opacityDark: null,
});
const MEDIA_PATH = /^\/api\/media\/[a-f0-9]{64}$/;

function finiteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/* Never throws: a backdrop that cannot be read is the default backdrop, not
   a refused publish, because nothing about it is worth losing an edit to
   the questions over. */
function cleanTheme(theme) {
  const t = plainObject(theme) ? theme : {};
  const photo =
    typeof t.photo === 'string' &&
    (t.photo === 'land.jpg' || t.photo === '' || MEDIA_PATH.test(t.photo))
      ? t.photo
      : THEME_DEFAULT.photo;
  const pos = finiteNumber(t.position);
  const op = (v) => {
    const n = finiteNumber(v);
    return n === null ? null : Math.min(1, Math.max(0, n));
  };
  return {
    photo,
    position: pos === null ? THEME_DEFAULT.position : Math.min(100, Math.max(0, pos)),
    opacityLight: op(t.opacityLight),
    opacityDark: op(t.opacityDark),
  };
}

/* ---- every string, through the same filter -----------------------------

   The reader renders this content with innerHTML, to everyone, so a
   published tree is the one place in this codebase where one account's
   words land in every other person's page. The filter (markup.js) is the
   boundary, so it runs over every string leaf — the questions, the pathways,
   the guide, the wording — rather than over the fields someone remembered
   hold HTML. A string with no "<" in it passes through unchanged, so plain
   prose, ids and labels are never rewritten. */
function cleanStrings(v, depth, where) {
  if (depth > MAX_DEPTH) {
    throw bad('bad_tree', `Something under ${where} is nested too deeply to be tree content.`);
  }
  if (typeof v === 'string') {
    if (v.length > MAX_STRING) {
      throw bad(
        'bad_tree',
        `One piece of text under ${where} is over ${MAX_STRING.toLocaleString('en-US')} characters. Shorten it and try again.`
      );
    }
    return cleanHtml(v);
  }
  if (Array.isArray(v)) return v.map((x) => cleanStrings(x, depth + 1, where));
  if (plainObject(v)) {
    /* fromEntries, not assignment: a key spelled "__proto__" stays an
       ordinary key instead of rewriting the new object's prototype. */
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, cleanStrings(x, depth + 1, where)])
    );
  }
  /* numbers, booleans and null are data the reader uses as data */
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
  return null;
}

/* A list of screens — the guide's sections, the walkthrough's pages. Each is
   a heading and a body and nothing else, which is all either renderer reads. */
function cleanScreens(list, what, max) {
  if (!Array.isArray(list)) {
    throw bad('bad_tree', `The ${what} must be a list of sections, each a heading and a body.`);
  }
  if (list.length > max) {
    throw bad(
      'bad_tree',
      `The ${what} has ${list.length} sections, and the most it can have is ${max}. Merge or remove some.`
    );
  }
  return list.map((sec, i) => {
    if (!plainObject(sec)) {
      throw bad('bad_tree', `Section ${i + 1} of the ${what} is not a heading and a body.`);
    }
    return {
      h: sec.h == null ? '' : String(sec.h),
      html: sec.html == null ? '' : String(sec.html),
    };
  });
}

/* The contact details. None of these is markup, and one of them is worse
   than markup: the reader puts calendly into an iframe's src and a link's
   href, and a javascript: URL there runs in the page's own origin — the
   tag filter never sees it, because it has no "<" in it. So:

     calendly            an https: URL or nothing. Not calendly.com only:
                         the editor promises that another scheduling
                         service still works as a link, and the reader is
                         the one that decides whether to embed it.
     name, role, email,  plain text: tags, and any stray < or > that could
     phone               still open one, taken out.

   Quotes stay. Mary O'Brien is a name and "Tribe's Air Program" a role,
   and the reader never puts these where a quote could matter: it escapes
   every one of them into element text (index.html whoHtml), and the email
   goes into a double-quoted href only after encodeURIComponent. Taking
   quotes out would protect nothing and would change people's names.

   Anything else in CONTACT is dropped; the reader reads these five. */
function plainText(v, max) {
  if (typeof v !== 'string') return '';
  /* whole tags first, so "<b>a@b.c</b>" keeps its words, then any stray
     character that could still start one */
  return str(v.replace(/<[^>]*>?/g, ''), { max }).replace(/[<>]/g, '');
}

function cleanContact(contact) {
  const c = plainObject(contact) ? contact : {};
  const cal = typeof c.calendly === 'string' ? cleanUrl(str(c.calendly, { max: 2000 })) : '';
  return {
    name: plainText(c.name, 160),
    role: plainText(c.role, 160),
    email: plainText(c.email, 254),
    phone: plainText(c.phone, 60),
    calendly: /^https:\/\/[^/?#\s]/i.test(cal) ? cal : '',
  };
}

export function cleanTreeData(data) {
  if (!plainObject(data)) throw bad('bad_tree', 'A tree needs an object of content.');
  const out = {};
  for (const k of TREE_KEYS) {
    if (data[k] !== undefined) out[k] = data[k];
  }
  if (!plainObject(out.NODES) || !Object.keys(out.NODES).length) {
    throw bad('bad_tree', 'A tree needs at least one question in NODES.');
  }
  /* Every option has to point somewhere, or the saved tree is a dead end the
     reader meets rather than an error the author sees. */
  for (const [id, node] of Object.entries(out.NODES)) {
    if (!plainObject(node) || !Array.isArray(node.a)) {
      throw bad('bad_tree', `Question "${id}" has no list of options.`);
    }
    for (const opt of node.a) {
      if (!plainObject(opt) || typeof opt.to !== 'string' || !opt.to) {
        throw bad('bad_tree', `An option under "${id}" points nowhere.`);
      }
    }
  }
  if (out.GUIDE !== undefined) out.GUIDE = cleanScreens(out.GUIDE, 'guide', MAX_GUIDE);
  if (out.COPY !== undefined) {
    if (!plainObject(out.COPY)) {
      throw bad(
        'bad_tree',
        'The wording (COPY) must be an object of groups, the way tree-data.js ships it.'
      );
    }
    const copy = { ...out.COPY };
    if (copy.walk !== undefined) copy.walk = cleanScreens(copy.walk, 'walkthrough', MAX_WALK);
    out.COPY = copy;
  }
  /* A record older than THEME simply has none, and the reader falls back to
     the shipped one; only a THEME that is there gets normalised. */
  if (out.THEME !== undefined) out.THEME = cleanTheme(out.THEME);
  if (out.CONTACT !== undefined) out.CONTACT = cleanContact(out.CONTACT);

  /* The reader builds each reference link as '<a href="' + u + '">' by
     concatenation, so a URL is the one string that lands inside an
     attribute rather than between tags, and the tag filter cannot see it
     there. It is made into a link the filter would have kept, with nothing
     in it that could close the quotes. */
  if (Array.isArray(out.LINKS)) {
    out.LINKS = out.LINKS.map((l) => (plainObject(l) ? { ...l, u: cleanUrl(l.u) } : l));
  }

  for (const k of Object.keys(out)) {
    /* already reduced to allowlisted values and plain text */
    if (k === 'THEME' || k === 'CONTACT') continue;
    out[k] = cleanStrings(out[k], 0, k);
  }
  return out;
}

/* ---- the published tree, cleaned once ----------------------------------

   GET /api/tree is the busiest request there is — every reader, every load,
   no account — and cleaning a large tree is real work. But what PUT stores
   has already been through cleanTreeData, so cleaning it again on the way
   out only matters for a row an older version stored. The row says which
   it is: PUT stores the cleaned tree with CLEAN_MARK set to CLEAN_VERSION,
   and GET serves a row carrying the current version as it is.

   The mark cannot be forged through the API. cleanTreeData keeps only
   TREE_KEYS, so a key named CLEAN_MARK in what someone sends is dropped
   before the server adds its own; and no version of this code has stored a
   key outside TREE_KEYS, so a row from before the mark existed has none.
   A row without the current mark — older, or marked by an older filter —
   is cleaned on every read until the next Publish, exactly as before.

   Bump CLEAN_VERSION whenever markup.js or cleanTreeData changes what it
   lets through. Every published row then counts as older, and is cleaned
   on the way out by the new rules. */
export const CLEAN_VERSION = '2026-09-a';
const CLEAN_MARK = '_cleanedBy';

export function markCleaned(clean) {
  return { ...clean, [CLEAN_MARK]: CLEAN_VERSION };
}

/* The published tree as a reader may see it. `fresh` is false when it had
   to be cleaned here. Throws, like cleanTreeData, when an older row no
   longer passes at all. */
export function servedTree(stored) {
  if (plainObject(stored) && stored[CLEAN_MARK] === CLEAN_VERSION) {
    const { [CLEAN_MARK]: _mark, ...data } = stored;
    return { data, fresh: true };
  }
  return { data: cleanTreeData(stored), fresh: false };
}

/* A saved path. Each step is {node, ai} and nothing else; the numbers are
   bounded so a stored path cannot index off the end of a question later. */
function cleanPath(path) {
  if (!Array.isArray(path)) throw bad('bad_path', 'A saved path must be a list of steps.');
  if (path.length > 200) throw bad('bad_path', 'That path is implausibly long.');
  return path.map((step, i) => {
    if (!plainObject(step) || typeof step.node !== 'string' || !step.node) {
      throw bad('bad_path', `Step ${i + 1} does not name a question.`);
    }
    const ai = Number(step.ai);
    if (!Number.isInteger(ai) || ai < 0 || ai > 99) {
      throw bad('bad_path', `Step ${i + 1} does not name an answer.`);
    }
    return { node: str(step.node, { max: 80 }), ai };
  });
}

function cleanCollected(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw bad('bad_collected', 'Pathways must be a list.');
  return list.slice(0, 40).map((s) => str(s, { max: 60 })).filter(Boolean);
}

/* Document bodies go through the same filter as tree content. These are the
   owner's own words, rendered back only to the owner, so here it is defence
   in depth rather than the boundary — it keeps a paste from a web page, and
   whatever that page had in it, out of the saved copy. The print-out's route
   drawing is inline SVG, and the filter keeps the drawing elements for it,
   and the print-out's own class names (CLASSES.document in markup.js). */
function cleanDocHtml(html) {
  const s = String(html == null ? '' : html);
  if (s.length > 400_000) throw tooLarge('That document is larger than 400,000 characters.');
  return cleanHtml(s, { classes: CLASSES.document });
}

/* Document meta is the client's own bookkeeping (which answers, which
   pathways), stored as it is sent. It is still bounded: nested deeply
   enough, JSON.stringify runs the stack out, and that has to be a refusal
   the author can read rather than a 500. jsonSize catches that case (it
   returns Infinity) and assertRecordSize refuses it. */
function cleanMeta(meta) {
  if (meta === undefined || meta === null) return {};
  if (!plainObject(meta)) throw bad('bad_meta', 'Document meta must be an object.');
  const deep = (v, d) => {
    if (d > MAX_DEPTH) throw bad('bad_meta', 'Document meta is nested too deeply.');
    if (Array.isArray(v)) for (const x of v) deep(x, d + 1);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) deep(x, d + 1);
  };
  deep(meta, 0);
  return meta;
}

/* ---- reading ----------------------------------------------------------- */

export async function listRecords(name, userId, { limit = 100, offset = 0, trash = false } = {}) {
  const k = kindOf(name);
  const cols =
    name === 'trees'
      ? 'id, title, note, created_at, updated_at, deleted_at, pg_column_size(data) as size'
      : name === 'runs'
        ? 'id, tree_id, title, note, terminal, jsonb_array_length(path) as steps, collected, created_at, updated_at, deleted_at'
        : 'id, run_id, tree_id, title, kind, edited, length(body_html) as size, meta, created_at, updated_at, deleted_at';
  const rows = await many(
    `select ${cols} from ${k.table}
      where user_id = $1 and deleted_at is ${trash ? 'not null' : 'null'}
      order by updated_at desc
      limit $2 offset $3`,
    [userId, limit, offset]
  );
  const total = await one(
    `select count(*)::int as n from ${k.table}
      where user_id = $1 and deleted_at is ${trash ? 'not null' : 'null'}`,
    [userId]
  );
  return { items: rows.map(camel), total: total?.n || 0, limit, offset };
}

/* Cleaned on the way out, as the published tree is. A record saved before
   the filter was what it is now — before it covered every string, before
   CONTACT.calendly was checked — is in the row as it was stored, and the
   pages put these fields into innerHTML (a saved path's snapshot becomes
   the tree the reader shows; a document body becomes the editor's page).
   The filter is idempotent, so for anything saved since, this changes
   nothing. A snapshot or tree that no longer validates comes back as null
   with a flag saying so, rather than failing the whole read: the title,
   the path and the note are still the owner's to see. */
function cleanOnRead(name, row) {
  if (name === 'trees') {
    try {
      row.data = cleanTreeData(row.data);
    } catch {
      row.data = null;
      row.invalid = true;
    }
  } else if (name === 'runs') {
    if (row.snapshot != null) {
      try {
        row.snapshot = cleanTreeData(row.snapshot);
      } catch {
        row.snapshot = null;
        row.snapshotInvalid = true;
      }
    }
  } else if (name === 'documents') {
    row.body_html = cleanHtml(row.body_html, { classes: CLASSES.document });
  }
  return row;
}

export async function getRecord(name, userId, id, { includeDeleted = false } = {}) {
  const k = kindOf(name);
  const row = await one(
    `select ${k.columns} from ${k.table}
      where id = $1 and user_id = $2 ${includeDeleted ? '' : 'and deleted_at is null'}`,
    [id, userId]
  );
  if (!row) throw notFound('That is not there — it may have been deleted.');
  delete row.user_id;
  return camel(cleanOnRead(name, row));
}

/* ---- the account's room --------------------------------------------------

   Every write that can add bytes runs in one transaction that first takes
   an advisory lock on the account. The check and the write then see the
   same state: two saves sent at once queue behind each other instead of
   both counting the rows as they were before either, which is how thirty
   parallel creates used to land on an account with room for five. The lock
   is transaction-scoped, so it holds through a transaction pooler and
   cannot outlive the request. */

async function lockAccount(client, userId) {
  await client.query('select pg_advisory_xact_lock($1, hashtext($2))', [QUOTA_LOCK, userId]);
}

/* Bytes the account holds in every row except `exceptId` (the one being
   written), deleted rows included. */
async function usedBytes(client, userId, exceptId) {
  const r = await client.query(
    `select (
       (select coalesce(sum(${ROW_BYTES.trees}), 0)     from trees     where user_id = $1 and id <> $2) +
       (select coalesce(sum(${ROW_BYTES.runs}), 0)      from runs      where user_id = $1 and id <> $2) +
       (select coalesce(sum(${ROW_BYTES.documents}), 0) from documents where user_id = $1 and id <> $2)
     )::bigint as n`,
    [userId, exceptId]
  );
  return Number(r.rows[0].n) || 0;
}

function kb(n) {
  return Math.round(n / 1024).toLocaleString('en-US') + ' KB';
}

/* A write may leave the account over its total only if it makes things no
   worse: an account that is over (because the limit was lowered, or it
   filled up before there was one) can still shorten a document or clear a
   snapshot on its way back under. Thrown inside the transaction, so the
   write it measured is rolled back. */
function assertBudget(before, after) {
  const cap = LIMITS.total.bytes;
  if (after > cap && after > before) {
    throw tooLarge(
      `Saving that would bring this account to ${kb(after)}, and the most one account can hold is ` +
        `${kb(cap)}, counting what is in Deleted. Permanently delete some saved work — from ` +
        'Deleted first — and try again.',
      'limit_reached'
    );
  }
}

/* One record of this kind, as it will be stored (after the filter, which
   can make a string several times longer than it arrived). */
function assertRecordSize(name, payload) {
  const lim = LIMITS[name];
  const size = jsonSize(payload);
  if (size > lim.bytes) {
    throw tooLarge(
      size === Infinity
        ? `That saved ${name.replace(/s$/, '')} cannot be measured — something in it is nested too deeply.`
        : `That is ${kb(size)}, and the limit for one saved ${name.replace(/s$/, '')} is ${kb(lim.bytes)}.`
    );
  }
}

/* Room for one more of this kind. Deleted rows count: they are still rows
   until someone purges them. */
async function assertCount(client, name, userId) {
  const lim = LIMITS[name];
  const c = await client.query(
    `select count(*)::int as n from ${kindOf(name).table} where user_id = $1`,
    [userId]
  );
  if ((c.rows[0]?.n || 0) >= lim.count) {
    throw bad(
      'limit_reached',
      `You have ${lim.count} saved ${name} already, counting any in Deleted, which is the limit. ` +
        'Permanently delete one to save another.'
    );
  }
}

/* The shape every create takes: lock, count, insert, measure. `insert` runs
   the INSERT on the transaction's client and returns the row, with its
   stored size as `bytes`. */
async function createWithin(name, userId, payload, insert) {
  assertRecordSize(name, payload);
  if (await databaseFull()) throw storageFull();
  return tx(async (client) => {
    await lockAccount(client, userId);
    await assertCount(client, name, userId);
    const id = crypto.randomUUID();
    const before = await usedBytes(client, userId, id);
    const row = await insert(client, id);
    assertBudget(before, before + Number(row.bytes));
    delete row.bytes;
    return camel(row);
  });
}

/* The shape every update takes: lock, read the row as it is, let `build`
   decide the SET list from it (and check the merged record's size), write,
   measure. `build(existing)` returns { sets, vals } with vals numbered from
   $3; $1 is the id and $2 the account. */
async function updateWithin(name, userId, id, readCols, returning, missing, build) {
  const k = kindOf(name);
  /* A full database refuses an edit only if it makes the record bigger, so
     shortening a document or clearing a snapshot still works. */
  const full = await databaseFull();
  return tx(async (client) => {
    await lockAccount(client, userId);
    const cur = await client.query(
      `select ${readCols}, ${ROW_BYTES[name]} as bytes from ${k.table}
        where id = $1 and user_id = $2 and deleted_at is null`,
      [id, userId]
    );
    const existing = cur.rows[0];
    if (!existing) throw notFound(missing);
    const { sets, vals } = await build(existing, client);
    if (!sets.length) throw bad('nothing_to_do', 'Nothing in that request would change anything.');
    const others = await usedBytes(client, userId, id);
    const r = await client.query(
      `update ${k.table} set ${sets.join(', ')}, updated_at = now()
        where id = $1 and user_id = $2 and deleted_at is null
        returning ${returning}, ${ROW_BYTES[name]} as bytes`,
      [id, userId, ...vals]
    );
    const row = r.rows[0];
    if (!row) throw notFound(missing);
    if (full && Number(row.bytes) > Number(existing.bytes)) throw storageFull();
    assertBudget(others + Number(existing.bytes), others + Number(row.bytes));
    delete row.bytes;
    return camel(row);
  });
}

/* A tree_id or run_id supplied by the client has to belong to the same
   account, or a saved document could point at someone else's row. On the
   transaction's own client: the pool holds one connection, and asking it
   for another from inside a transaction would wait forever. */
async function ownedOrNull(client, table, userId, id) {
  if (!id) return null;
  const r = await client.query(`select id from ${table} where id = $1 and user_id = $2`, [
    id,
    userId,
  ]);
  return r.rows[0] ? r.rows[0].id : null;
}

/* ---- writing ----------------------------------------------------------- */

export async function createTree(userId, { title, note, data }) {
  const clean = cleanTreeData(data);
  return createWithin('trees', userId, clean, async (client, id) => {
    const r = await client.query(
      `insert into trees (id, user_id, title, note, data)
       values ($1, $2, $3, $4, $5)
       returning id, title, note, created_at, updated_at, ${ROW_BYTES.trees} as bytes`,
      [
        id,
        userId,
        str(title, { max: 160 }) || 'Untitled tree',
        str(note, { max: 2000 }),
        JSON.stringify(clean),
      ]
    );
    return r.rows[0];
  });
}

export async function updateTree(userId, id, patch) {
  /* cleaned before the lock is taken: it is the slow part, and needs
     nothing from the database */
  const clean = patch.data !== undefined ? cleanTreeData(patch.data) : undefined;
  if (clean !== undefined) {
    const size = jsonSize(clean);
    if (size > LIMITS.trees.bytes) {
      throw tooLarge(`That tree is ${kb(size)}, over the ${kb(LIMITS.trees.bytes)} limit.`);
    }
  }
  return updateWithin(
    'trees',
    userId,
    id,
    'id',
    'id, title, note, created_at, updated_at',
    'That tree is not there.',
    async () => {
      const sets = [];
      const vals = [];
      const $ = (v) => '$' + (vals.push(v) + 2);
      if (patch.title !== undefined) {
        sets.push(`title = ${$(str(patch.title, { max: 160 }) || 'Untitled tree')}`);
      }
      if (patch.note !== undefined) sets.push(`note = ${$(str(patch.note, { max: 2000 }))}`);
      if (clean !== undefined) sets.push(`data = ${$(JSON.stringify(clean))}`);
      return { sets, vals };
    }
  );
}

export async function createRun(userId, body) {
  const path = cleanPath(body.path);
  const collected = cleanCollected(body.collected);
  const snapshot = body.snapshot === undefined || body.snapshot === null ? null : cleanTreeData(body.snapshot);
  const payload = { path, collected, snapshot };
  return createWithin('runs', userId, payload, async (client, id) => {
    const treeId = await ownedOrNull(client, 'trees', userId, body.treeId);
    const r = await client.query(
      `insert into runs (id, user_id, tree_id, title, note, path, collected, terminal, snapshot)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id, tree_id, title, note, terminal, created_at, updated_at, ${ROW_BYTES.runs} as bytes`,
      [
        id,
        userId,
        treeId,
        str(body.title, { max: 160 }) || 'Untitled path',
        str(body.note, { max: 2000 }),
        JSON.stringify(path),
        JSON.stringify(collected),
        body.terminal ? str(body.terminal, { max: 60 }) : null,
        snapshot ? JSON.stringify(snapshot) : null,
      ]
    );
    return r.rows[0];
  });
}

export async function updateRun(userId, id, patch) {
  const path = patch.path !== undefined ? cleanPath(patch.path) : undefined;
  const collected = patch.collected !== undefined ? cleanCollected(patch.collected) : undefined;
  const snapshot =
    patch.snapshot === undefined ? undefined : patch.snapshot ? cleanTreeData(patch.snapshot) : null;
  /* the part of the record that has a size, only fetched when it changes */
  const sized = path !== undefined || collected !== undefined || snapshot !== undefined;
  return updateWithin(
    'runs',
    userId,
    id,
    sized ? 'id, path, collected, snapshot' : 'id',
    'id, tree_id, title, note, terminal, created_at, updated_at',
    'That saved path is not there.',
    async (existing, client) => {
      /* The same limit createRun applies, to the record as it will be once
         this change is in it — not just to the part that changed. */
      if (sized) {
        assertRecordSize('runs', {
          path: path !== undefined ? path : existing.path,
          collected: collected !== undefined ? collected : existing.collected,
          snapshot: snapshot !== undefined ? snapshot : existing.snapshot,
        });
      }
      const sets = [];
      const vals = [];
      const $ = (v) => '$' + (vals.push(v) + 2);
      if (patch.title !== undefined) {
        sets.push(`title = ${$(str(patch.title, { max: 160 }) || 'Untitled path')}`);
      }
      if (patch.note !== undefined) sets.push(`note = ${$(str(patch.note, { max: 2000 }))}`);
      if (path !== undefined) sets.push(`path = ${$(JSON.stringify(path))}`);
      if (collected !== undefined) sets.push(`collected = ${$(JSON.stringify(collected))}`);
      if (patch.terminal !== undefined) {
        sets.push(`terminal = ${$(patch.terminal ? str(patch.terminal, { max: 60 }) : null)}`);
      }
      if (snapshot !== undefined) sets.push(`snapshot = ${$(snapshot ? JSON.stringify(snapshot) : null)}`);
      if (patch.treeId !== undefined) {
        sets.push(`tree_id = ${$(await ownedOrNull(client, 'trees', userId, patch.treeId))}`);
      }
      return { sets, vals };
    }
  );
}

export async function createDocument(userId, body) {
  const html = cleanDocHtml(body.bodyHtml);
  const meta = cleanMeta(body.meta);
  return createWithin('documents', userId, { html, meta }, async (client, id) => {
    const runId = await ownedOrNull(client, 'runs', userId, body.runId);
    const treeId = await ownedOrNull(client, 'trees', userId, body.treeId);
    const r = await client.query(
      `insert into documents (id, user_id, run_id, tree_id, title, kind, body_html, meta, edited)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id, run_id, tree_id, title, kind, edited, created_at, updated_at, ${ROW_BYTES.documents} as bytes`,
      [
        id,
        userId,
        runId,
        treeId,
        str(body.title, { max: 200 }) || 'Untitled document',
        str(body.kind, { max: 40 }) || 'result',
        html,
        JSON.stringify(meta),
        !!body.edited,
      ]
    );
    return r.rows[0];
  });
}

export async function updateDocument(userId, id, patch) {
  const html = patch.bodyHtml !== undefined ? cleanDocHtml(patch.bodyHtml) : undefined;
  let meta;
  if (patch.meta !== undefined) {
    if (!plainObject(patch.meta)) throw bad('bad_meta', 'Document meta must be an object.');
    meta = cleanMeta(patch.meta);
  }
  const sized = html !== undefined || meta !== undefined;
  return updateWithin(
    'documents',
    userId,
    id,
    sized ? 'id, body_html, meta' : 'id',
    'id, run_id, tree_id, title, kind, edited, created_at, updated_at',
    'That document is not there.',
    async (existing, client) => {
      /* The same limit createDocument applies, on the same measure, to the
         document as it will be — body and meta together. jsonSize, not
         JSON.stringify, so a meta too deep to serialise is a 413 here too. */
      if (sized) {
        assertRecordSize('documents', {
          html: html !== undefined ? html : existing.body_html,
          meta: meta !== undefined ? meta : existing.meta,
        });
      }
      const sets = [];
      const vals = [];
      const $ = (v) => '$' + (vals.push(v) + 2);
      if (patch.title !== undefined) {
        sets.push(`title = ${$(str(patch.title, { max: 200 }) || 'Untitled document')}`);
      }
      if (patch.kind !== undefined) sets.push(`kind = ${$(str(patch.kind, { max: 40 }) || 'result')}`);
      if (html !== undefined) sets.push(`body_html = ${$(html)}`);
      if (meta !== undefined) sets.push(`meta = ${$(JSON.stringify(meta))}`);
      if (patch.edited !== undefined) sets.push(`edited = ${$(!!patch.edited)}`);
      if (patch.runId !== undefined) {
        sets.push(`run_id = ${$(await ownedOrNull(client, 'runs', userId, patch.runId))}`);
      }
      return { sets, vals };
    }
  );
}

/* ---- deleting ---------------------------------------------------------- */

export async function softDelete(name, userId, id) {
  const k = kindOf(name);
  const row = await one(
    `update ${k.table} set deleted_at = now(), updated_at = now()
      where id = $1 and user_id = $2 and deleted_at is null
      returning id`,
    [id, userId]
  );
  if (!row) throw notFound('That is not there.');
  return { id: row.id, deleted: true };
}

/* Restoring adds nothing to what the account holds, since deleted rows
   already count. It is still checked, under the same lock as every other
   write, because an account can be over its limits without having added
   anything — rows from before deleted ones counted, or a limit lowered
   since — and restoring must not be the way such an account keeps growing
   its live work. Refused, the answer says what to purge. */
export async function restore(name, userId, id) {
  const k = kindOf(name);
  const lim = LIMITS[name];
  return tx(async (client) => {
    await lockAccount(client, userId);
    const there = await client.query(
      `select id from ${k.table} where id = $1 and user_id = $2 and deleted_at is not null`,
      [id, userId]
    );
    if (!there.rows[0]) throw notFound('That is not in the deleted list.');
    const c = await client.query(`select count(*)::int as n from ${k.table} where user_id = $1`, [
      userId,
    ]);
    if ((c.rows[0]?.n || 0) > lim.count) {
      throw bad(
        'limit_reached',
        `You have more than ${lim.count} saved ${name}, counting the ones in Deleted, which is over ` +
          'the limit. Permanently delete some from Deleted, then restore this one.'
      );
    }
    const total = await usedBytes(client, userId, NO_ROW);
    if (total > LIMITS.total.bytes) {
      throw tooLarge(
        `This account holds ${kb(total)}, counting what is in Deleted, and the most it can hold is ` +
          `${kb(LIMITS.total.bytes)}. Permanently delete some saved work, then restore this one.`,
        'limit_reached'
      );
    }
    const r = await client.query(
      `update ${k.table} set deleted_at = null, updated_at = now()
        where id = $1 and user_id = $2 and deleted_at is not null
        returning id`,
      [id, userId]
    );
    return { id: r.rows[0].id, restored: true };
  });
}

/* Permanent, and only ever reached by an explicit ?purge=1 from a confirmed
   click in the UI. */
export async function purge(name, userId, id) {
  const k = kindOf(name);
  const row = await one(`delete from ${k.table} where id = $1 and user_id = $2 returning id`, [
    id,
    userId,
  ]);
  if (!row) throw notFound('That is not there.');
  return { id: row.id, purged: true };
}

export async function counts(userId) {
  const r = await one(
    `select
       (select count(*)::int from trees     where user_id = $1 and deleted_at is null) as trees,
       (select count(*)::int from runs      where user_id = $1 and deleted_at is null) as runs,
       (select count(*)::int from documents where user_id = $1 and deleted_at is null) as documents,
       (select count(*)::int from trees     where user_id = $1 and deleted_at is not null) as "trashedTrees",
       (select count(*)::int from runs      where user_id = $1 and deleted_at is not null) as "trashedRuns",
       (select count(*)::int from documents where user_id = $1 and deleted_at is not null) as "trashedDocuments"`,
    [userId]
  );
  return r || {};
}

/* snake_case out of Postgres, camelCase into JSON — the client is JavaScript
   and should not have to remember which side of the wire it is on. */
function camel(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === '_unused') continue;
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out;
}
