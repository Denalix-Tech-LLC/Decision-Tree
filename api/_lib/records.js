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
import { one, many } from './db.js';
import { bad, notFound, tooLarge, str, jsonSize } from './http.js';

/* Per-account ceilings. Generous for real use, low enough that a runaway
   script cannot fill the database. */
export const LIMITS = {
  trees: { count: 200, bytes: 1_500_000 },
  runs: { count: 1000, bytes: 400_000 },
  documents: { count: 1000, bytes: 1_000_000 },
};

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
   reader will not read. */
const TREE_KEYS = ['NODES', 'OUT', 'NONTAS', 'CRITERIA', 'NEXT', 'LINKS', 'DISC', 'CONTACT', 'GUIDE'];

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
  return out;
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

/* Defence in depth for document bodies. These are the owner's own words,
   rendered back only to the owner, so this is not the boundary that keeps the
   deployment safe — it is the one that keeps a paste from a web page out of
   the saved copy. Scripts, event handlers, and anything that loads or frames
   another origin come out. */
/* svg stays: the document opens with a drawing of the route taken, and that
   drawing is inline SVG this tool generated. What comes out of it is the part
   that can run something — script, foreignObject, use, and the SMIL elements
   that can rewrite an attribute after the fact. */
const VOID_OUT = /<\s*\/?\s*(script|iframe|object|embed|link|meta|base|form|input|button|textarea|select|style|math|foreignobject|use|animate|animatetransform|animatemotion|set)\b[^>]*>/gi;
const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
const ON_ATTR = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTR = /\s(href|src|xlink:href|action|formaction|data|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

function cleanHtml(html) {
  let s = String(html == null ? '' : html);
  if (s.length > 400_000) throw tooLarge('That document is larger than 400,000 characters.');
  s = s.replace(SCRIPT_BLOCK, '').replace(STYLE_BLOCK, '');
  s = s.replace(VOID_OUT, '');
  s = s.replace(ON_ATTR, '');
  /* A relative URL is left alone. An absolute one keeps only the schemes a
     document has any business carrying — plus data: for an image, which is how
     a pasted diagram survives the save. */
  s = s.replace(URL_ATTR, (m, attr, dq, sq, bare) => {
    const val = String(dq ?? sq ?? bare ?? '').trim();
    const scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(val);
    if (!scheme) return m;
    const sc = scheme[1].toLowerCase();
    if (SAFE_SCHEMES.has(sc)) return m;
    if (sc === 'data' && /^(src|poster)$/i.test(attr) && /^data:image\//i.test(val)) return m;
    return ' ' + attr + '="#"';
  });
  return s;
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

export async function getRecord(name, userId, id, { includeDeleted = false } = {}) {
  const k = kindOf(name);
  const row = await one(
    `select ${k.columns} from ${k.table}
      where id = $1 and user_id = $2 ${includeDeleted ? '' : 'and deleted_at is null'}`,
    [id, userId]
  );
  if (!row) throw notFound('That is not there — it may have been deleted.');
  delete row.user_id;
  return camel(row);
}

/* ---- writing ----------------------------------------------------------- */

async function assertRoom(name, userId, payload) {
  const lim = LIMITS[name];
  const size = jsonSize(payload);
  if (size > lim.bytes) {
    throw tooLarge(
      `That is ${Math.round(size / 1024)} KB, and the limit for one saved ${name.replace(/s$/, '')} is ${Math.round(lim.bytes / 1024)} KB.`
    );
  }
  const c = await one(
    `select count(*)::int as n from ${kindOf(name).table} where user_id = $1 and deleted_at is null`,
    [userId]
  );
  if ((c?.n || 0) >= lim.count) {
    throw bad(
      'limit_reached',
      `You have ${lim.count} saved ${name} already, which is the limit. Delete one to save another.`
    );
  }
}

/* A tree_id or run_id supplied by the client has to belong to the same
   account, or a saved document could point at someone else's row. */
async function ownedOrNull(table, userId, id) {
  if (!id) return null;
  const row = await one(`select id from ${table} where id = $1 and user_id = $2`, [id, userId]);
  return row ? row.id : null;
}

export async function createTree(userId, { title, note, data }) {
  const clean = cleanTreeData(data);
  await assertRoom('trees', userId, clean);
  const row = await one(
    `insert into trees (id, user_id, title, note, data)
     values ($1, $2, $3, $4, $5)
     returning id, title, note, created_at, updated_at`,
    [
      crypto.randomUUID(),
      userId,
      str(title, { max: 160 }) || 'Untitled tree',
      str(note, { max: 2000 }),
      JSON.stringify(clean),
    ]
  );
  return camel(row);
}

export async function updateTree(userId, id, patch) {
  const sets = [];
  const vals = [id, userId];
  if (patch.title !== undefined) {
    sets.push(`title = $${vals.push(str(patch.title, { max: 160 }) || 'Untitled tree')}`);
  }
  if (patch.note !== undefined) sets.push(`note = $${vals.push(str(patch.note, { max: 2000 }))}`);
  if (patch.data !== undefined) {
    const clean = cleanTreeData(patch.data);
    const size = jsonSize(clean);
    if (size > LIMITS.trees.bytes) {
      throw tooLarge(`That tree is ${Math.round(size / 1024)} KB, over the ${Math.round(LIMITS.trees.bytes / 1024)} KB limit.`);
    }
    sets.push(`data = $${vals.push(JSON.stringify(clean))}`);
  }
  if (!sets.length) throw bad('nothing_to_do', 'Nothing in that request would change anything.');
  const row = await one(
    `update trees set ${sets.join(', ')}, updated_at = now()
      where id = $1 and user_id = $2 and deleted_at is null
      returning id, title, note, created_at, updated_at`,
    vals
  );
  if (!row) throw notFound('That tree is not there.');
  return camel(row);
}

export async function createRun(userId, body) {
  const path = cleanPath(body.path);
  const collected = cleanCollected(body.collected);
  const snapshot = body.snapshot === undefined || body.snapshot === null ? null : cleanTreeData(body.snapshot);
  const payload = { path, collected, snapshot };
  await assertRoom('runs', userId, payload);
  const treeId = await ownedOrNull('trees', userId, body.treeId);
  const row = await one(
    `insert into runs (id, user_id, tree_id, title, note, path, collected, terminal, snapshot)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id, tree_id, title, note, terminal, created_at, updated_at`,
    [
      crypto.randomUUID(),
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
  return camel(row);
}

export async function updateRun(userId, id, patch) {
  const sets = [];
  const vals = [id, userId];
  if (patch.title !== undefined) {
    sets.push(`title = $${vals.push(str(patch.title, { max: 160 }) || 'Untitled path')}`);
  }
  if (patch.note !== undefined) sets.push(`note = $${vals.push(str(patch.note, { max: 2000 }))}`);
  if (patch.path !== undefined) sets.push(`path = $${vals.push(JSON.stringify(cleanPath(patch.path)))}`);
  if (patch.collected !== undefined) {
    sets.push(`collected = $${vals.push(JSON.stringify(cleanCollected(patch.collected)))}`);
  }
  if (patch.terminal !== undefined) {
    sets.push(`terminal = $${vals.push(patch.terminal ? str(patch.terminal, { max: 60 }) : null)}`);
  }
  if (patch.snapshot !== undefined) {
    sets.push(
      `snapshot = $${vals.push(patch.snapshot ? JSON.stringify(cleanTreeData(patch.snapshot)) : null)}`
    );
  }
  if (patch.treeId !== undefined) {
    sets.push(`tree_id = $${vals.push(await ownedOrNull('trees', userId, patch.treeId))}`);
  }
  if (!sets.length) throw bad('nothing_to_do', 'Nothing in that request would change anything.');
  const row = await one(
    `update runs set ${sets.join(', ')}, updated_at = now()
      where id = $1 and user_id = $2 and deleted_at is null
      returning id, tree_id, title, note, terminal, created_at, updated_at`,
    vals
  );
  if (!row) throw notFound('That saved path is not there.');
  return camel(row);
}

export async function createDocument(userId, body) {
  const html = cleanHtml(body.bodyHtml);
  const meta = body.meta === undefined || body.meta === null ? {} : body.meta;
  if (!plainObject(meta)) throw bad('bad_meta', 'Document meta must be an object.');
  await assertRoom('documents', userId, { html, meta });
  const runId = await ownedOrNull('runs', userId, body.runId);
  const treeId = await ownedOrNull('trees', userId, body.treeId);
  const row = await one(
    `insert into documents (id, user_id, run_id, tree_id, title, kind, body_html, meta, edited)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id, run_id, tree_id, title, kind, edited, created_at, updated_at`,
    [
      crypto.randomUUID(),
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
  return camel(row);
}

export async function updateDocument(userId, id, patch) {
  const sets = [];
  const vals = [id, userId];
  if (patch.title !== undefined) {
    sets.push(`title = $${vals.push(str(patch.title, { max: 200 }) || 'Untitled document')}`);
  }
  if (patch.kind !== undefined) sets.push(`kind = $${vals.push(str(patch.kind, { max: 40 }) || 'result')}`);
  if (patch.bodyHtml !== undefined) {
    const html = cleanHtml(patch.bodyHtml);
    if (jsonSize({ html }) > LIMITS.documents.bytes) {
      throw tooLarge('That document is over the size limit for one saved document.');
    }
    sets.push(`body_html = $${vals.push(html)}`);
  }
  if (patch.meta !== undefined) {
    if (!plainObject(patch.meta)) throw bad('bad_meta', 'Document meta must be an object.');
    sets.push(`meta = $${vals.push(JSON.stringify(patch.meta))}`);
  }
  if (patch.edited !== undefined) sets.push(`edited = $${vals.push(!!patch.edited)}`);
  if (patch.runId !== undefined) {
    sets.push(`run_id = $${vals.push(await ownedOrNull('runs', userId, patch.runId))}`);
  }
  if (!sets.length) throw bad('nothing_to_do', 'Nothing in that request would change anything.');
  const row = await one(
    `update documents set ${sets.join(', ')}, updated_at = now()
      where id = $1 and user_id = $2 and deleted_at is null
      returning id, run_id, tree_id, title, kind, edited, created_at, updated_at`,
    vals
  );
  if (!row) throw notFound('That document is not there.');
  return camel(row);
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

export async function restore(name, userId, id) {
  const k = kindOf(name);
  const row = await one(
    `update ${k.table} set deleted_at = null, updated_at = now()
      where id = $1 and user_id = $2 and deleted_at is not null
      returning id`,
    [id, userId]
  );
  if (!row) throw notFound('That is not in the deleted list.');
  return { id: row.id, restored: true };
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
