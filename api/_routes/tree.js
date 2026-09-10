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
import { json, noContent, readJson, route, str, bad } from '../_lib/http.js';
import { requireEditor } from '../_lib/auth.js';
import { cleanTreeData } from '../_lib/records.js';
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
    json(res, 200, {
      published: true,
      storage: 'ready',
      data: row.data,
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
      [ROW, JSON.stringify(data), note, user.id]
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
