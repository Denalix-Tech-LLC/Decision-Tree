/* ===========================================================================
   THE SCHEMA
   One string, used by two callers: `npm run db:init` (deliberate, from a
   terminal) and the first request a cold function serves (automatic, so a
   fresh deployment against an empty database works without a deploy step
   nobody remembers). Every statement is `if not exists`, so running it twice
   is a no-op and running it against a live database changes nothing.

   No extensions are required. Ids are generated in Node with
   crypto.randomUUID() rather than gen_random_uuid(), and email uniqueness is a
   unique index on lower(email) rather than citext — so this runs on a plain
   managed Postgres with no superuser rights: Neon, Supabase, RDS, or a local
   server.

   Long-term storage is the point of this file, so nothing here is dropped or
   rewritten on deploy. Schema changes go in MIGRATIONS below, appended, never
   edited in place.
   ========================================================================= */

export const SCHEMA_VERSION = 3;

export const SCHEMA_SQL = `
create table if not exists schema_meta (
  k text primary key,
  v text not null,
  updated_at timestamptz not null default now()
);

/* ---- accounts ---------------------------------------------------------- */
create table if not exists users (
  id             uuid primary key,
  email          text not null,
  name           text not null default '',
  password_hash  text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_login_at  timestamptz
);
create unique index if not exists users_email_key on users (lower(email));

/* Opaque session tokens. Only the SHA-256 of a token is stored, so a dump of
   this table cannot be replayed as a login. */
create table if not exists sessions (
  id           uuid primary key,
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  user_agent   text not null default '',
  ip           text not null default ''
);
create index if not exists sessions_user_idx    on sessions (user_id);
create index if not exists sessions_expires_idx on sessions (expires_at);

/* Throttling for login and register. Rows are pruned by age, not kept. */
create table if not exists auth_attempts (
  id      bigserial primary key,
  bucket  text not null,
  ok      boolean not null default false,
  at      timestamptz not null default now()
);
create index if not exists auth_attempts_bucket_idx on auth_attempts (bucket, at desc);

/* ---- saved work ------------------------------------------------------- */

/* A saved decision-tree *definition* — the questions, options, pathways and
   result copy that /admin edits. Same shape as tree-data.js. */
create table if not exists trees (
  id          uuid primary key,
  user_id     uuid not null references users(id) on delete cascade,
  title       text not null default 'Untitled tree',
  note        text not null default '',
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists trees_user_idx on trees (user_id, updated_at desc);

/* A saved *path through* a tree — what a reader answered, so they can return
   to it later and carry on, or show Council how they got there. "snapshot"
   holds the tree content as it stood when the path was saved: without it a
   later edit to the tree would silently rewrite what someone had recorded. */
create table if not exists runs (
  id          uuid primary key,
  user_id     uuid not null references users(id) on delete cascade,
  tree_id     uuid references trees(id) on delete set null,
  title       text not null default 'Untitled path',
  note        text not null default '',
  path        jsonb not null default '[]'::jsonb,
  collected   jsonb not null default '[]'::jsonb,
  terminal    text,
  snapshot    jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists runs_user_idx on runs (user_id, updated_at desc);

/* A generated document, and then an edited one. "body_html" starts as what the
   result panel produced and becomes whatever the author made of it; "edited"
   records whether a human has touched it, because "regenerate" must never
   overwrite someone's writing without saying so. */
create table if not exists documents (
  id          uuid primary key,
  user_id     uuid not null references users(id) on delete cascade,
  run_id      uuid references runs(id) on delete set null,
  tree_id     uuid references trees(id) on delete set null,
  title       text not null default 'Untitled document',
  kind        text not null default 'result',
  body_html   text not null default '',
  meta        jsonb not null default '{}'::jsonb,
  edited      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists documents_user_idx on documents (user_id, updated_at desc);
create index if not exists documents_run_idx  on documents (run_id);
`;

/* Appended, never edited. Each entry runs once, in order, and is recorded in
   schema_meta under its own key. `sql` must be safe to run twice anyway. */
export const MIGRATIONS = [
  {
    /* Sign in with Google. An account that arrived through Google has no
       password at all, so password_hash stops being required; the unique
       index is on a nullable column, which permits any number of accounts
       with no Google identity and only one per Google identity. */
    key: '2-google-identity',
    sql: `
      alter table users add column if not exists google_sub  text;
      alter table users add column if not exists avatar_url  text;
      alter table users alter column password_hash drop not null;
      create unique index if not exists users_google_sub_key on users (google_sub);
    `,
  },
  {
    /* The published tree: one row, the content every reader is served.
       Until something is published the reader falls back to tree-data.js, the
       file the repo ships — so this table being empty is the normal state of a
       fresh deployment rather than a missing setup step. */
    key: '3-published-tree',
    sql: `
      create table if not exists site_tree (
        id            text primary key,
        data          jsonb not null,
        note          text not null default '',
        published_by  uuid references users(id) on delete set null,
        published_at  timestamptz not null default now()
      );
    `,
  },
];
