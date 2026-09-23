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

export const SCHEMA_VERSION = 7;

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
  {
    /* Uploaded images — today, only the backdrop photograph the editor picks
       at /admin. Keyed by the SHA-256 of the bytes, so the same picture
       uploaded twice is one row, and the URL of an image is a promise about
       its content: /api/media/<hash> can be cached for a year because what it
       names can never change. The bytes live in Postgres rather than a blob
       store because this deployment has exactly one storage dependency and a
       few hundred KB of photograph is not a reason to add a second.
       `mime` is what the server sniffed from the bytes, never what the
       uploader claimed. Deleting the account that uploaded one leaves the
       image, because a published tree may still be showing it. */
    key: '4-media',
    sql: `
      create table if not exists media (
        hash        text primary key,
        mime        text not null,
        bytes       bytea not null,
        size        integer not null,
        created_by  uuid references users(id) on delete set null,
        created_at  timestamptz not null default now()
      );
    `,
  },
  {
    /* Whether the address on an account has been PROVEN, as opposed to typed.
       Registration takes whatever address is entered and there is no mail
       path to check it, so on its own users.email proves nothing — and
       ADMIN_EMAIL used to hand the editor to whoever registered that address
       first. Only two things set this: a Google sign-in whose ID token says
       email_verified for that exact address, or scripts/admin-user.mjs run by
       someone who already holds the database. Password registration never
       does. Accounts that already carry a Google identity arrived through
       Google (or were attached to it by their owner), so their address is
       taken as proven here rather than asking every one of them to prove it
       again. */
    key: '5-email-verified',
    sql: `
      alter table users add column if not exists email_verified boolean not null default false;
      update users set email_verified = true where google_sub is not null and email_verified = false;
    `,
  },
  {
    /* When this session last PROVED who it is — a password typed, a Google
       round trip — as distinct from when it was created or last seen. A
       sensitive change (a password, a sign-in method, closing the account,
       signing other browsers out) needs either the password in the request
       or a proof this recent, so a browser left signed in on a shared
       machine is not all it takes. Null for sessions made before this
       existed: they count as not recent, and one sign-in fixes that.
       The (user_id, created_at) index serves the per-account cap, which
       drops the oldest sessions beyond the newest twenty. */
    key: '6-session-authed-at',
    sql: `
      alter table sessions add column if not exists authed_at timestamptz;
      create index if not exists sessions_user_created_idx on sessions (user_id, created_at desc);
    `,
  },
  {
    /* A Google sign-in in flight. The browser holds only a random id in a
       cookie; the state, nonce, destination and — for "attach Google to this
       account" — the session that asked, live here, so none of it can be
       forged or edited by whoever can write a cookie. The row is deleted by
       the callback that uses it (single use) and expires after ten minutes.
       id_hash is the SHA-256 of the cookie value, for the same reason
       sessions store a hash: a dump of this table is not a set of live
       flows. */
    key: '7-oauth-flows',
    sql: `
      create table if not exists oauth_flows (
        id_hash     text primary key,
        state       text not null,
        nonce       text not null,
        next        text not null default '/',
        link        boolean not null default false,
        session_id  uuid,
        created_at  timestamptz not null default now(),
        expires_at  timestamptz not null
      );
      create index if not exists oauth_flows_expires_idx on oauth_flows (expires_at);
    `,
  },
];
