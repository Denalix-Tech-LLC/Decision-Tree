/* ===========================================================================
   THE THREE COLLECTIONS
   trees, runs and documents differ in what they hold and not at all in how
   they are addressed, so the routing lives here once and each route file is
   two lines. Every handler is scoped to the signed-in account: there is no
   path by which one account reads another's work, because user_id is in every
   where-clause rather than checked afterwards.
   ========================================================================= */
import { requireUser } from './auth.js';
import { json, noContent, readJson, route, queryOf, intOf, boolOf, requireUuid, bad } from './http.js';
import {
  listRecords,
  getRecord,
  createTree,
  updateTree,
  createRun,
  updateRun,
  createDocument,
  updateDocument,
  softDelete,
  restore,
  purge,
} from './records.js';

const CREATE = { trees: createTree, runs: createRun, documents: createDocument };
const UPDATE = { trees: updateTree, runs: updateRun, documents: updateDocument };

export function collectionRoute(name) {
  return route({
    async GET(req, res) {
      const user = await requireUser(req, res);
      const q = queryOf(req);
      const out = await listRecords(name, user.id, {
        limit: intOf(q.limit, 100, 1, 200),
        offset: intOf(q.offset, 0, 0, 100_000),
        trash: boolOf(q.trash),
      });
      json(res, 200, out);
    },
    async POST(req, res) {
      const user = await requireUser(req, res);
      const body = await readJson(req);
      const row = await CREATE[name](user.id, body);
      json(res, 201, { item: row });
    },
  });
}

export function itemRoute(name) {
  return route({
    async GET(req, res) {
      const user = await requireUser(req, res);
      const q = queryOf(req);
      const id = requireUuid(q.id);
      const row = await getRecord(name, user.id, id, { includeDeleted: boolOf(q.trash) });
      json(res, 200, { item: row });
    },
    async PATCH(req, res) {
      const user = await requireUser(req, res);
      const q = queryOf(req);
      const id = requireUuid(q.id);
      /* Restore rides on PATCH rather than having a verb of its own: it is a
         change to one field, and the client already knows how to PATCH. */
      if (boolOf(q.restore)) {
        json(res, 200, await restore(name, user.id, id));
        return;
      }
      const body = await readJson(req);
      const row = await UPDATE[name](user.id, id, body);
      json(res, 200, { item: row });
    },
    async PUT(req, res) {
      const user = await requireUser(req, res);
      const id = requireUuid(queryOf(req).id);
      const body = await readJson(req);
      const row = await UPDATE[name](user.id, id, body);
      json(res, 200, { item: row });
    },
    async DELETE(req, res) {
      const user = await requireUser(req, res);
      const q = queryOf(req);
      const id = requireUuid(q.id);
      if (boolOf(q.purge)) {
        /* Permanent. The client asks for this only from a confirmed click,
           and the confirmation names what is about to go. */
        if (!boolOf(q.confirm)) {
          throw bad(
            'confirm_required',
            'A permanent delete needs confirm=1 as well as purge=1 — this cannot be undone.'
          );
        }
        json(res, 200, await purge(name, user.id, id));
        return;
      }
      await softDelete(name, user.id, id);
      noContent(res);
    },
  });
}
