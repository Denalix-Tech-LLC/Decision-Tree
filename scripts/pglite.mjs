/* A throwaway Postgres, for testing with nothing installed.

   PGlite is Postgres itself compiled to WebAssembly; pglite-socket puts it
   behind a TCP socket speaking the ordinary wire protocol, so `pg` connects to
   it exactly as it would to a server. That means the self-test exercises the
   real SQL — the jsonb columns, the partial indexes, the cascades — rather
   than a mock that agrees with whatever the code does.

   It is a devDependency and nothing in /api imports it. A deployment talks to
   a real database through DATABASE_URL; this is only so `npm run selftest`
   works on a laptop with no Postgres.
   ========================================================================= */
export async function startPglite(dir) {
  let PGlite, PGLiteSocketServer;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
    ({ PGLiteSocketServer } = await import('@electric-sql/pglite-socket'));
  } catch {
    return null; /* devDependencies not installed — the caller falls back */
  }
  /* With a directory it persists there, so a local sign-in survives a
     restart; without one it lives in memory and is gone when the process is,
     which is what a test wants. */
  const db = dir ? await PGlite.create(dir) : await PGlite.create();
  const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
  await server.start();
  const port = server.port || (server.server && server.server.address().port);
  if (!port) {
    await server.stop();
    await db.close();
    return null;
  }
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
    port,
    async stop() {
      try {
        await server.stop();
      } catch {
        /* already down */
      }
      try {
        await db.close();
      } catch {
        /* already closed */
      }
    },
  };
}
