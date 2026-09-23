/* POST /api/media   upload an image — the body is the raw bytes, not JSON

   Editor only, by the same gate as publishing the tree: an uploaded image
   exists to be shown to every reader, so uploading one is part of changing
   what readers see. It goes through route(), which means the same-origin
   and X-TAS-App checks every other write gets.

   The answer names the image by the hash of its bytes. The editor puts
   `url` into THEME.photo, and that exact shape — /api/media/<64 hex> — is
   the only uploaded form the tree validation lets through.
   ========================================================================= */
import { json, readRaw, route } from '../../_lib/http.js';
import { requireEditor } from '../../_lib/auth.js';
import { MAX_IMAGE_BYTES, checkImage, storeImage } from '../../_lib/media.js';

export default route({
  async POST(req, res) {
    const user = await requireEditor(req, res);
    const buf = await readRaw(req, MAX_IMAGE_BYTES);
    const mime = checkImage(req.headers['content-type'], buf);
    const saved = await storeImage(buf, mime, user.id);
    json(res, 200, {
      hash: saved.hash,
      url: '/api/media/' + saved.hash,
      mime: saved.mime,
      size: saved.size,
    });
  },
});
