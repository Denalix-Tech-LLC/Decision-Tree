/* GET    /api/tree   the content every reader is served
   PUT    /api/tree   publish what the editor has on screen
   DELETE /api/tree   unpublish, back to the file the repo ships

   This is the seam the README always pointed at: the reader's tree, its
   editor, and the print-out all read one JSON shape, and until now that shape
   only ever arrived as a static file, so publishing meant committing an
   export. It still can. This adds the other way — one account edits at
   /admin, presses Publish, and every reader has it on their next load.

   GET is public and unauthenticated on purpose: it is the same content the
   static file serves, to the same people, and requiring a session to read the
   questions would make a guest's tree depend on an account.

   Nothing is published on a fresh deployment, and that is a normal state
   rather than a missing step: `published: false` means the reader keeps
   whatever tree-data.js ships.
   ========================================================================= */
import { json, noContent, readJson, route, str, bad, tooLarge, jsonSize } from '../_lib/http.js';
import { requireEditor } from '../_lib/auth.js';
import { cleanTreeData, servedTree, markCleaned, LIMITS } from '../_lib/records.js';
import { one, isConfigured } from '../_lib/db.js';

const ROW = 'current';

export default route({
  async GET(_req, res) {
    /* No database is a supported deployment: say so plainly and let the page
       fall back to the file, rather than failing a read the reader needs. */
    if (!isConfigured()) {
      json(res, 200, { published: false, storage: 'unconfigured' });
      return;
    }
    const row = await one(
      `select data, note, published_at from site_tree where id = $1`,
      [ROW]
    );
    if (!row) {
      json(res, 200, { published: false, storage: 'ready' });
      return;
    }
    /* Cleaned on the way out as well as on the way in — but only when the
       row needs it. What this version's PUT stored is marked as cleaned by
       this version of the filter, and is served as it is; anything else (a
       tree published before the filter covered every string, or before the
       filter was what it is now) is cleaned here, by the same validator PUT
       uses, so there is one rule and no second copy of it. See servedTree
       in records.js. If what is stored no longer passes at all, readers get
       the shipped tree rather than an error, and the editor sees why on the
       next Publish. */
    let served;
    try {
      served = servedTree(row.data);
    } catch (err) {
      console.error('[api] the published tree no longer validates:', err && err.message);
      json(res, 200, { published: false, storage: 'ready', invalid: true });
      return;
    }
    if (!served.fresh) {
      /* Store what was just served, marked, so the next reader does not pay
         for cleaning it again. Only if the row still holds what was read: a
         Publish in between always differs (it carries the mark), and wins.
         Never at the cost of this response: a database that refuses the
         write (full, say) still serves the cleaned tree. */
      await one(`update site_tree set data = $2 where id = $1 and data = $3::jsonb`, [
        ROW,
        JSON.stringify(markCleaned(served.data)),
        JSON.stringify(row.data),
      ]).catch((err) => console.error('[api] could not store the re-cleaned tree:', err && err.message));
    }
    json(res, 200, {
      published: true,
      storage: 'ready',
      data: served.data,
      note: row.note,
      publishedAt: row.published_at,
    });
  },

  async PUT(req, res) {
    const user = await requireEditor(req, res);
    const body = await readJson(req);
    /* The same validation a saved tree gets: every option has to point
       somewhere, because this one is going in front of readers. */
    const data = cleanTreeData(body.data);
    /* And the same ceiling, measured after the filter (which can make a
       string several times longer than it arrived): this row is sent to
       every reader on every load, so its size is everyone's wait. */
    const size = jsonSize(data);
    if (size > LIMITS.trees.bytes) {
      throw tooLarge(
        `That tree is ${Math.round(size / 1024)} KB, over the ${Math.round(LIMITS.trees.bytes / 1024)} KB limit for a published tree.`
      );
    }
    const note = str(body.note, { max: 2000 });
    const row = await one(
      `insert into site_tree (id, data, note, published_by, published_at)
       values ($1, $2, $3, $4, now())
       on conflict (id) do update
         set data = excluded.data,
             note = excluded.note,
             published_by = excluded.published_by,
             published_at = now()
       returning published_at`,
      [ROW, JSON.stringify(markCleaned(data)), note, user.id]
    );
    json(res, 200, { published: true, publishedAt: row.published_at });
  },

  async DELETE(req, res) {
    await requireEditor(req, res);
    const row = await one(`delete from site_tree where id = $1 returning id`, [ROW]);
    if (!row) throw bad('not_published', 'Nothing is published, so there is nothing to withdraw.');
    /* Readers fall back to tree-data.js from their next load. */
    noContent(res);
  },
});
