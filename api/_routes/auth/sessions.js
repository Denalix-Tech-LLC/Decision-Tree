/* GET    /api/auth/sessions   every browser currently signed in as you
   DELETE /api/auth/sessions   sign the others out, keeping this one

   This exists because the tool gets opened on shared machines — a Council
   laptop, a conference-room desktop — and "am I still signed in over there"
   is otherwise unanswerable.

   Signing the others out is sensitive too — from a borrowed session it
   would throw the owner off every machine they use — so it needs the
   password in `password` or a sign-in within the last ten minutes.
   ========================================================================= */
import { json, readJson, route } from '../../_lib/http.js';
import { requireUser, requireRecentAuth, endAllSessions } from '../../_lib/auth.js';
import { many } from '../../_lib/db.js';

export default route({
  async GET(req, res) {
    const user = await requireUser(req, res);
    const rows = await many(
      `select id, created_at, last_seen_at, expires_at, user_agent, ip
         from sessions where user_id = $1 and expires_at > now()
        order by last_seen_at desc limit 50`,
      [user.id]
    );
    json(res, 200, {
      items: rows.map((r) => ({
        id: r.id,
        current: r.id === user.sessionId,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        expiresAt: r.expires_at,
        /* The full user-agent string is a fingerprint and reads like noise;
           what the account holder needs is enough to recognise a machine. */
        device: describe(r.user_agent),
      })),
    });
  },

  async DELETE(req, res) {
    const user = await requireUser(req, res);
    const body = (await readJson(req)) || {};
    await requireRecentAuth(req, user, { password: String(body.password || '') });
    await endAllSessions(user.id, user.sessionId);
    json(res, 200, { ok: true });
  },
});

function describe(ua) {
  const s = String(ua || '');
  if (!s) return 'Unknown device';
  const os = /Windows NT/i.test(s)
    ? 'Windows'
    : /Mac OS X|Macintosh/i.test(s)
      ? 'Mac'
      : /Android/i.test(s)
        ? 'Android'
        : /iPhone|iPad|iOS/i.test(s)
          ? 'iOS'
          : /Linux/i.test(s)
            ? 'Linux'
            : '';
  const br = /Edg\//i.test(s)
    ? 'Edge'
    : /OPR\//i.test(s)
      ? 'Opera'
      : /Firefox\//i.test(s)
        ? 'Firefox'
        : /Chrome\//i.test(s)
          ? 'Chrome'
          : /Safari\//i.test(s)
            ? 'Safari'
            : 'Browser';
  return [br, os].filter(Boolean).join(' on ') || 'Unknown device';
}
