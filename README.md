# TAS Decision Tree

An interactive decision-support tool that helps a federally recognized Tribe decide
**whether**, and **for which Clean Air Act sections**, to seek "Treated as a State" (TAS)
status under the Tribal Authority Rule (40 CFR Part 49).

> General information to support discussion — **not legal advice, and not an official
> EPA product.** Confirm all citations against 40 CFR Part 49 and the current Clean Air
> Act, and consult Tribal legal counsel before applying.

## Pages

| Path | What it is |
|---|---|
| `/` | **Growing decision tree** — answer a question, the tree branches. Unchosen branches stay visible and greyed so the whole decision sits on one canvas. Click a greyed branch to re-route. |
| `/admin` | **Tree editor** — the questions, options, pathways and result copy, edited on a canvas. Limited to one account; see *Who may edit*. |
| `/work` | **My work** — saved paths, saved documents and saved trees, for a signed-in reader. Holds the document editor. |

There were four more pages once — `/graph`, `/pathfinder`, `/wizard` and `/review`,
alternate presentations of the same decision. They are gone. Nothing linked to them, and
none of them loaded `tree-data.js`: each carried a frozen copy of the questions and the
citations, so editing the tree left them quietly showing something else. For a tool whose
whole claim is that its section numbers are right, four unmaintained copies of them was a
liability rather than a feature. They are in the history if a version is ever wanted
back — `git show d02ecc3:pathfinder.html` and so on.

On `/`, a first-time reader meets a five-screen **walkthrough** before the tree: what
the tool is for (with the disclaimer, first), how answering grows the tree, how a greyed
branch and the **✕** let them change their mind, what a pathway and the result are, and
what keeping the work costs. The last button says **Begin the tree**, and pressing it is
what starts it. **Skip** does the same thing sooner. Its diagrams are drawn in the tree's
own idiom rather than being screenshots, so they theme themselves and cannot go stale.

A returning reader (`tas-walk-seen`) lands straight on question 1, and **Guide** in the
top bar brings the walkthrough back at any point — someone pressing a button marked
Guide nearly always wants to be shown how this works, and five screens with pictures
answers that better than ten sections of prose. `/?walk=1` does the same by link.

The **guide** is the manual behind it, one button further in: **Full guide**, on every
screen of the walkthrough. Ten sections covering the same ground in full, plus moving
around the canvas, what each pathway means, changing the content at `/admin`, editing a
saved document, and who to ask. Its own footer has a **Walkthrough** button back, so
neither is a dead end. `/admin` and `/work` link straight to the manual at `/?guide=1`,
because a reader who is already editing is past the introduction — and the guide lives
with the behaviour it describes rather than being copied onto three pages that would
drift apart.

A link that carries saved work — `/?run=<id>` — skips both, because that reader is
coming back to something rather than meeting the tool.

The **Contact** button is available throughout, not only at the end — a reader most
needs a person mid-tree, at the boundary question. It says so there: while a question
the content marks `risky` is the open one, Contact takes the risk colour, breathes, and
a callout points up at it reading *Worth a word with counsel*. Answering the question
puts it back; cutting back to it raises it again. It keys off the `risky` flag in the
data rather than a question id, so a tree edited at `/admin` gets the same behaviour on
whatever it marks. Below 560px the callout goes and the colour stays, because the bar
wraps there and the words would sit over the standing notice.

The panel itself is two things and no more.

**Ask a question.** One box for what the reader wants to know, their name and email so a
reply can reach them, and a checkbox to attach the route they took — the same rows the
print-out draws, so the two describe one route the same way. **Send question** opens their
own mail program; **Copy** is there for a reader with no mail client registered, or a path
long enough to push a `mailto` past what some clients accept. Nothing posts from the page.

**Book a time.** Calendly does the scheduling. The panel used to carry a month picker and a
slot list of its own, which was the wrong shape for the job: it could not see anyone's
availability, so it only ever *proposed* a time by email and a reader could pick a slot that
was already taken. Calendly knows. The frame is a plain `iframe` — no third-party script —
and it goes up with the panel. It sat behind a **Show the calendar** button at first, on the
reasoning that nobody who came to type a question should load a third-party page uninvited;
pressing **Contact** is that invitation, and a calendar nobody can see is not a scheduling
feature. The note beside the frame says whose service it is. Whatever they typed is
carried in as a Calendly prefill (`name`, `email`, and `a1` for the event's first custom
question), so the question does not have to be written twice. A **New tab** link sits beside
it and stays after the frame mounts, because a frame that will not load on some networks is
no reason to lose the other way in; its prefill keeps updating as the reader types, while the
mounted frame is deliberately left alone — rebuilding it on a keystroke would reload
Calendly under someone mid-booking.

The five contact fields ship **empty**, and the panel says so plainly rather than
naming anyone. Fill them in at `/admin` → **Content → Contact** and export before the
tool is shared. With no email address set, **Send question** stays disabled and *Copy* is the
way through. With no `calendly` link set, the *Book a time* section says so and points at
`/admin` rather than showing a dead button. Another scheduling service still works as a
link; it just will not embed.

### Disclaimers

There are seven, because they do different jobs, and all seven are editable at
`/admin` under **Content → Disclaimers**:

| Key | Where it appears |
|---|---|
| `bar` | the standing strip under the progress rail, for the whole session |
| `guide` | the "what this tool is not" box, high in the guide |
| `boundary` | the danger card in the result, when a boundary answer came up |
| `authority` | its own card in the result — eligibility is not authority |
| `result` | the closing note at the foot of the result panel |
| `print` | the print-out, written to stand alone months later with none of the tool around it |
| `cites` | the note about the section numbers, in the result and on the print-out |

The bar and the guide say the same thing on purpose. The guide is passed once; the bar
is the whole session.

## Accounts, guests and saved work

A reader can use the whole tool without an account, and that is a supported way to use
it rather than a degraded one: answer every question, re-route the tree, open the
result, print it. Nothing is sent anywhere and nothing is asked for.

What a guest cannot do is **keep** any of it. The path is gone when the tab closes, and
the editor's working copy lives in `localStorage` on one machine.

A guest is not shown the controls that would only refuse them. **Save** in the top bar,
**Save as document** in the result and **My trees** in the editor appear when there is
an account to save to and are absent before that — a row of buttons whose only outcome
is a dialog explaining they cannot is furniture, not an offer. Signing in lives in one
place, the account button in the top bar, and everything appears the moment it means
something. What a guest gets instead is **Print**, which is the thing that actually
keeps a result for them, and a line in the result saying so.

Signing in adds three kinds of saved work and changes nothing else:

| Kind | What it is | Saved from |
|---|---|---|
| **Path** (`runs`) | the answers someone gave, plus a **snapshot of the tree they answered** | **Save** in the top bar at `/` |
| **Document** (`documents`) | the print-out, editable word by word afterwards | **Save as document** in the result |
| **Tree** (`trees`) | the questions, options, pathways and result copy | **My trees** at `/admin` |

The snapshot matters. Without it, editing a question at `/admin` would silently rewrite
what someone recorded months ago in front of Council: the answers would still be there,
attached to questions that no longer say the same thing. A saved path reopens against
the tree it was answered against, whatever has changed since.

Deleting anything moves it to a deleted list. Purging is a separate, confirmed action
(`?purge=1&confirm=1`), and closing an account needs the word `DELETE` and proof that it
is the owner: the password, or for an account with no password (one made through
Google) a sign-in within the last ten minutes. There is no undo past that point and no
backup — the dialog says so. The same proof is asked, once in a while, before changing a
password or linking or unlinking Google.

An account is a place to keep work and nothing more. It is not a submission to EPA, it
is not visible to anyone else, and nobody is notified when it is used. The tool sends
no email: there is no address-verification step and no password-reset link, because
there is no mail path and inventing one would be a bigger promise than this deployment
can keep. Someone with database access resets a forgotten password instead:

```bash
node scripts/admin-user.mjs passwd someone@example.org
```

It asks for the new password at a hidden prompt, typed twice. A password is never a
command-line argument — that would put it in shell history and the process list — so
one given as an argument is refused. For automation, set `TAS_NEW_PASSWORD` from a
secret store, or pipe the password in on the first line of stdin. `passwd` also ends
every session on the account.

The same script creates an account (`create`, which also prompts), marks an address
verified (`verify` — see [Who may edit](#who-may-edit)), lists accounts, shows what one
holds, signs a person out everywhere, and deletes an account with its work. It is the
whole of the administration story, and it is deliberately not a page on the site.

### Two ways in

**Email and a password**, always. Passwords are hashed with `scrypt`; the rule is ten
characters and no more composition theatre than that, because four more characters buy
more than a mandatory capital letter does.

**Sign in with Google**, when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
The button appears by itself and is absent otherwise — a deployment that wants only
email and password needs to do nothing to get one. It is the ordinary authorization-code
flow, written out by hand in `api/_lib/google.js`: no SDK, no extra dependency, one
short-lived `HttpOnly` cookie carrying the `state` and `nonce` that make the callback
unforgeable, and `openid email profile` as the entire scope — this tool never acts on
anyone's Google account, it only asks who is signing in.

Set it up at
[console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials):
an OAuth 2.0 Client ID of type *Web application*, with one authorised redirect URI per
deployment.

```
https://your-project.vercel.app/api/auth/google/callback
http://localhost:8777/api/auth/google/callback
```

The two ways in meet on a **verified** email address. Registering with a password never
verifies one — nothing in that proves the person owns the address — but Google does. So
when a Google sign-in's address matches an existing account:

- if that account's address is already verified, it is the same proven person, and the
  Google identity is attached;
- if it is not, whoever registered it never proved the address was theirs, and Google
  has just proved who does. The owner takes the account over: the password someone else
  chose is removed and every session on it ends, so anyone who pre-registered the address
  keeps neither. The owner can set their own password afterwards.

An account's address is never rewritten to a Google one. An account created through
Google has no password, and **Account settings** offers to set one so nobody is
locked to a single route; the same panel attaches or detaches a Google account, and
refuses to detach the only way in. Typing a password for a Google-only account gets
told to use the button rather than a wrong-password message it could never satisfy.

There is no password reset by email, for either route — see above.

Sessions last at most 30 days (sooner if unused), and an account keeps no more than 20.
Over HTTPS the cookie is `__Host-tas_session`; the first deploy that introduced the prefix
signed everyone out once, which is expected.

### If there is no database

`DATABASE_URL` unset is a supported configuration, not a broken one. `/api/auth/me`
answers `storage: "unconfigured"`, the account button reads **No saving**, and the tool
behaves exactly as it did before accounts existed. The same is true if the database is
configured but unreachable — saving is refused with a plain sentence, and nothing else
stops working.

## Stack

Static HTML pages, and a small API for accounts and storage.

Every page is still a single self-contained file with inlined CSS and JS, and still
makes no external requests. Two shared scripts sit beside them: `tree-data.js` (the
content) and `account.js` (accounts, saved work, and the dialogs that explain them).

The API is one Vercel serverless function, `api/[...route].js`, written in plain Node
ESM. One runtime dependency — `pg` — and no build step. The eighteen endpoints live in
`api/_routes/` and the catch-all dispatches to them — see **One function, eighteen
endpoints** below for why. Passwords are hashed with `scrypt` from
`node:crypto`; sessions are opaque random tokens in an `HttpOnly` cookie, stored as
SHA-256 so a database dump cannot be replayed as a login. Google sign-in is the OAuth
flow written out with `fetch`, not a library.

```
index.html  admin.html  work.html   one file per URL, each with its own CSS and JS
theme.css                           the palette and the backdrop, shared by all three
view.js                             the pan/zoom arithmetic the tree and the editor share
tree-data.js                        the content: questions, pathways, result copy
account.js                          accounts and saved work, in the browser
api/
  [...route].js                     the only serverless function: dispatches the below
  _routes/
    health.js                       is storage there, and does the schema exist yet
    tree.js                         the content readers are served: GET, and PUT to publish
    auth/         register login logout me password sessions account
    auth/google/  start callback unlink    sign in with Google, when configured
    trees/ runs/ documents/         index.js (list, create), [id].js (read, change, delete)
  _lib/         db schema auth records crud http google
dev-server.mjs                      static + functions locally, no Vercel CLI
scripts/                            db:init  db:prune  selftest  selftest:api  check
                                    admin-user
docs/                               notes that are not instructions
```

The three pages sit at the root because that is what makes them `/`, `/admin` and
`/work`. `theme.css` exists because they were carrying three copies of the palette and
the backdrop between them, and three copies drift: the editor had lost `--gold` and
`--mono`, never got the manual dark-theme block the other two have, and was still
treating a horizon photograph for the cool sky it had before the sunset. What stays in a
page is what differs on purpose — the editor moves the sun out from behind its inspector,
the work page fades its ridges — and each of those sits with the rest of that page's own
styling.

Storage is Postgres. Anything Postgres works — Neon, Supabase, Vercel Postgres, RDS, a
local server — because the schema needs no extensions: ids are generated in Node with
`crypto.randomUUID()`, and email uniqueness is a unique index on `lower(email)` rather
than `citext`. The schema is one string in `api/_lib/schema.js`, every statement
`if not exists`, applied by `npm run db:init` or by the first request a cold function
serves, under an advisory lock so two cold starts cannot race.

## Deploy

Every push to `master` deploys to production by itself, via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

**One-time setup — do this before the first push, or the workflow run will fail.**
Link the project locally:

```bash
npx vercel link
```

That writes `.vercel/project.json` (gitignored). Generate a token at
<https://vercel.com/account/tokens>, then add three repository secrets under
**Settings → Secrets and variables → Actions**:

| Secret | Where it comes from |
|---|---|
| `VERCEL_TOKEN` | the access token you just generated |
| `VERCEL_ORG_ID` | `orgId` in `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | `projectId` in the same file |

There is a simpler alternative: connect the repo through the Vercel dashboard's Git
integration, which needs no token and no workflow file — delete
`.github/workflows/deploy.yml` if you go that way. Do not enable both, or every push
deploys twice.

Manual deploys still work, and need no secrets:

```bash
npx vercel --prod
```

No build configuration is needed beyond `vercel.json` (clean URLs, security headers,
`no-store` on `/api`, and `npm install --omit=dev` so the 27 MB WebAssembly Postgres
used for local testing is not installed on every deploy). Vercel installs `pg` and
turns each file under `api/` into a function; nothing else runs at deploy time.

### One function, eighteen endpoints

Vercel turns every file under `api/` into its own serverless function, and the Hobby
plan allows twelve. This project has eighteen endpoints, so a deployment was refused
outright:

```
No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan.
```

So there is one function. `api/[...route].js` is a catch-all that dispatches to the
route modules, which moved to `api/_routes/` — the leading underscore is what keeps
Vercel from counting them, the same convention `_lib/` already used. The URLs did not
change, and neither did the route files beyond the depth of their `_lib` imports.

The routing table in that file is written out by hand, and has to be. Vercel bundles a
function by following its imports statically, so an `import()` of a computed path is
invisible to it: the route modules would be left out of the bundle and every endpoint
would 404 in production while working perfectly on a laptop. Every route is therefore a
real static import.

The dev server still resolves routes by walking `api/_routes` from disk, because that is
what lets a route file be edited without a restart. Two resolvers for one set of URLs
can drift, and the way it shows up is the worst kind — an endpoint that works locally
and 404s only once deployed — so `npm run selftest` compares the table against the
files and fails if either side grows a route the other has not heard of.

`npm run selftest` runs both halves: `scripts/selftest.mjs` drives the dev server, then
`scripts/catchall.mjs` (`npm run selftest:api`) serves the same API through the
catch-all with `req.query` shaped the way the Vercel runtime shapes it, so the
production dispatch is exercised rather than assumed.

Raising the limit is the other fix: a Pro team lifts it and the eighteen files could go
back where they were. One function is not a workaround for the plan so much as a
reasonable shape for an API this size — every endpoint already shares `_lib`, so they
share a bundle anyway.

### Turning on accounts

Accounts, sign-up and sign-in are already written and tested — what a fresh deployment
lacks is somewhere to put them. Until a connection string is set, the account chip reads
**No saving**, which is the tool being honest rather than broken: everything else works,
and nothing can be kept.

Any Postgres does. Two routes, and the first needs no account you do not already have.

#### Route A — from Vercel, no new signup

Vercel's dashboard → your project → **Storage** → **Create** a Postgres database (the
marketplace offers Neon; the free tier is enough — see [Limits](#limits) for how the tool
keeps within it). Connect it to the project and Vercel
sets the environment variables itself — no connection string to copy, no password to
handle, and it gives you the pooled one by default.

The code reads whichever of these turns up, in this order:

```
DATABASE_URL  >  POSTGRES_URL  >  POSTGRES_PRISMA_URL
```

which covers both the Neon marketplace integration and the older Vercel Postgres one.

One trap: those integrations also set `DATABASE_URL_UNPOOLED` (or
`POSTGRES_URL_NON_POOLING`). That is the **direct** connection, for migrations and long
jobs. Never point `DATABASE_URL` at it — if you do, serverless will open a connection
per instance and exhaust the server. `npm run db:check` says so if it sees one set.

Then set `ADMIN_EMAIL` in the same place (see below), and **redeploy** — environment
variables do not apply to deployments that already exist.

#### Route B — Supabase

Only if you would rather hold the database yourself.

**1. Make the database.** [supabase.com](https://supabase.com) → New project. Save the database
password it gives you — it is shown once.

**2. Take the *pooler* connection string.** Project Settings → Database → Connection
string → **Transaction pooler**. It looks like this:

```
postgresql://postgres.abcdefghijklm:PASSWORD@aws-0-eu-west-2.pooler.supabase.com:6543/postgres
```

Not the one labelled *Direct connection*. That host is IPv6-only, which Vercel's
functions generally cannot reach, and it gives one connection per instance with no
pooling — serverless will exhaust it. The give-away is the shape: a pooler user is
`postgres.<project-ref>`, a direct one is plain `postgres`.

**3. Try it before you deploy.** Put the string in `.env` as `DATABASE_URL`, then:

```bash
npm run db:check
```

(It also takes the string as an argument, but then the password lands in your shell
history.)

It reports what the string points at, creates the schema, counts what is there, and
names the cause when nothing answers — DNS, a refused password, the wrong pooler user,
an IPv6-only host — instead of leaving you with "connection failed". It never prints the
password.

**4. Put it in Vercel.** Project → Settings → Environment Variables, for **Production**
(and Preview, if accounts should work on preview deployments too):

| Variable | Value |
|---|---|
| `DATABASE_URL` | the pooler string from step 2 |
| `ADMIN_EMAIL` | the one address allowed to publish the tree — and it must be verified |

**5. Redeploy.** Environment variables do not apply to deployments that already exist,
so nothing changes until a new one is built. The chip goes from *No saving* to *Sign in*,
and `/api/auth/me` starts answering `"storage": "ready"`.

Attaching a Postgres from Vercel's own Storage tab works too and sets the variables for
you — the code reads `DATABASE_URL`, `POSTGRES_URL` or `POSTGRES_PRISMA_URL`, whichever
turns up.

#### Set ADMIN_EMAIL in the same breath

With a database attached, registration is open to anyone, and `PUT /api/tree` publishes
the tree **every reader sees**. So the gate fails closed: with a database and no
`ADMIN_EMAIL`, **nobody** can publish — not even you — and `/api/health` says
`"editor": "nobody: …"` until it is set. Set it with `DATABASE_URL`, not after, and
redeploy.

The account must also have a **verified** address, or it still cannot publish. After the
deploy, do one of these once:

- sign in with **Google** as that address, or
- from a checkout whose `.env` points at the same database, run
  `node scripts/admin-user.mjs verify you@example.org` (for an account you know is yours),
  or `passwd` / `create`, which set a password at a prompt and verify the account.

With both in place the gate holds — *the named, verified account is the editor; another
signed-in account is not, and a guest is not*. A comma-separated list is accepted for a
handover; one address is the intent.

`/admin` itself is the same sign-in. There is no second login: the editor is the account
named in `ADMIN_EMAIL`, signing in through the same chip as everyone else. Anyone else
who reaches the page is told the editor is limited to one account.

#### What survives a transaction pooler

A transaction pooler hands each transaction whichever backend is free, so nothing that
depends on session state can be relied on between statements. Two things follow, both
already done, and both of which fail *only in production* if got wrong:

- **The schema lock is transaction scoped.** `pg_advisory_lock` is session scoped: taken
  outside an explicit transaction, the lock, the DDL and the unlock can each land on a
  different backend — no mutual exclusion, and the lock strands on whichever backend
  took it. `ensureSchema()` uses `pg_advisory_xact_lock` inside one transaction, which
  stays on one backend and releases itself at commit.
- **No unusual startup parameters.** A pooler refuses the whole connection over one it
  does not recognise, and node-postgres sends `statement_timeout` in the startup packet.
  The pool does not set it; `query_timeout` (client side, always works) is the guarantee,
  and the schema transaction sets `SET LOCAL statement_timeout` where it matters.

The session pooler on port 5432 keeps session state and also works. The transaction
pooler suits serverless better.

### The database


One environment variable, `DATABASE_URL`, set under **Project → Settings → Environment
Variables** for Production (and Preview, if you want accounts on preview deployments).
Use the provider's **pooled** host where one is offered — serverless functions open a
connection per instance.

```
postgres://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=require
```

Then, once, from a checkout with the same variable in `.env`:

```bash
npm run db:init
```

That is optional — a cold function creates the schema itself on the first request — but
running it means a mistake surfaces at setup time instead of on someone's first save.
It prints the tables it finds and how many accounts exist.

TLS certificate verification is off by default, because managed Postgres is usually
signed by a chain Node does not carry. Ask for it with `PGSSLMODE` (or `sslmode=` in the
URL): `verify-full` checks the chain and the host name, `verify-ca` the chain only.
`PGSSLROOTCERT` names the CA — a file path, the PEM text itself (Vercel has variables but
no files), or `system` for Node's own store, which also means `verify-full`. A request to
verify wins over anything that would turn TLS off, and a CA that cannot be read is an
error rather than a silent downgrade.

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` go in the same place if you want the
Google button; leaving them out is a complete configuration, not a missing one. Add
each deployment's `/api/auth/google/callback` to the authorised redirect URIs — preview
deployments included, if accounts are on there too.

Housekeeping is optional and can go on cron:

```bash
npm run db:prune -- --trash 90 --media
```

Expired and over-age sessions, stale login attempts and abandoned Google sign-ins always
go; `--trash 90` also purges work that has been in someone's deleted list for over 90
days, and `--media` removes uploaded images more than a week old that no published tree,
saved tree or saved path mentions. (It cannot see an unpublished, unsaved draft in the
editor's own browser, so publish or save before relying on it.)

### Limits

Sized for a free-tier database of about 0.5 GB, because on Neon going over the storage
cap makes every write fail — including the ones that let people sign in. Each can be
raised with an environment variable on a bigger database:

| Limit | Default | Variable |
|---|---|---|
| everything one account keeps: paths, documents, trees — deleted ones too, until purged | 5 MB | `TAS_ACCOUNT_BYTES` |
| uploaded backdrop images, for the whole deployment | 25 MB | `TAS_MEDIA_BYTES` |
| the database as a whole: past it new work is refused, sign-in still works | 400 MB | `TAS_DB_BYTES` |
| successful registrations per client address per hour | 20 | `TAS_REGISTRATIONS_PER_IP` |

The registration limit is per address because a Tribal office, a conference room or a
workshop usually reaches the internet through one; raise it for a larger session. A
refused request says why in a sentence, and points at the prune command where that is
the answer.

### Before you deploy a change

- **A new file the site serves** (a page, a script, an image) must be let in by
  `.vercelignore`, which is an allowlist: anything it does not name stays off the
  deployment. `npm run check` fails if a page references a file it would leave out, and
  warns about files the site needs that git does not track yet.
- **An edit to an inline `<script>`** in `index.html`, `admin.html` or `work.html` changes
  its hash, and the Content-Security-Policy in `vercel.json` allows scripts by hash. Run
  `npm run csp` after the edit; `npm run check` fails until you do, and the dev server
  sends the same headers, so a stale hash blanks the page locally before it can in
  production.

## Local development

```bash
npm install
npm run dev:local
```

`dev:local` serves the pages the way Vercel does (clean URLs, `no-store`), runs the
functions in-process, and starts a throwaway Postgres — PGlite, Postgres compiled to
WebAssembly, from `devDependencies` — persisted in `.pglite/`. Accounts and saving work
with nothing installed. The data is on that machine and nowhere else.

`npm run dev` is the same server without the throwaway database: it reads `DATABASE_URL`
from `.env` if there is one, and otherwise runs in the guest-only mode a deployment
without storage would be in.

```bash
npm run selftest
```

Walks the whole path a person walks — register, sign in, save a tree, save a path, save
a document, edit it, delete it, restore it, purge it, close the account — and then
tries the things that must **not** work: a cross-origin write, a missing app header,
another account's records, a wrong password, an unconfirmed purge. It runs against
PGlite by default; with `DATABASE_URL` set it uses that database instead, creating a
throwaway account and deleting it again at the end.

```bash
npm run check
```

Parses the inline `<script>` block in every page. The pages carry their JavaScript
inline, so a syntax error in one is otherwise invisible until it renders blank.

For layout, `scripts/responsive.js` runs in the browser and asserts what a layout
must not break at any size — nothing off the edge, nothing too small to tap, no
card wider than its canvas, the open question and its answers on screen, the
standing notice visible. [docs/responsive.md](docs/responsive.md) covers how to
run it and which sizes are worth covering. The tree sizes its own cards against
the stage rather than switching to a separate mobile layout: three answers share
the width available, down to a floor, and the gaps tighten below 440px.

## Notes on correctness

The content was reviewed against the Clean Air Act and 40 CFR Part 49. Corrections
carried into every version:

- Regional haze is **§169A** (not "169(a)(1)" — §169 is PSD definitions)
- Title V is **§§501–507** (there is no CAA §500)
- §129 is **solid-waste combustion**; landfills fall under §111/§112
- **Performance** Partnership Grant (not "Program Partnership Group")
- §105 grants without TAS carry the standard **40%** match; TAS reduces it to 5%, then up to 10%
- Boundary risk: EPA's approval is a final Agency action subject to judicial challenge, and
  an adverse ruling could impact the Tribe's jurisdictional boundaries, **including loss of
  Tribal lands** (reviewer's wording, 2026 — this replaces an earlier line saying the risk
  did not reach land title)
- Decision logic: the boundary question is phrased so risk-weighing attaches to
  *disputed* boundaries (the source document had these branches inverted)

`<meta charset="utf-8">` is declared in every file — without it, servers that don't
send a charset mangle every em-dash, curly quote and `§`.

## Editing the tree

Everything a reader sees lives in `tree-data.js`: the questions and options, the
pathways, the result content, the seven disclaimers, the contact details, the guide,
the walkthrough, the wording of every label and heading (`COPY`), and the backdrop
(`THEME`). Edit it by hand, or visually at **`/admin`**.

The editor draws the whole tree — every question with its options fanned
beneath it — and you edit by clicking a card. You can retitle anything, add or
remove options, point an option at any question or ending, and give an option a hint,
a note shown once it is chosen, and a detail for the full result. The Content tab holds
the rest: Result, Disclaimers, Contact, Guide, Walkthrough, Wording and Appearance. A
Checks tab flags options that lead nowhere, questions with no text, and questions
nothing can reach.

The guide and the verdict headlines quote the pathway names, so renaming a pathway
under Pathways means renaming it there too.

Edits **save themselves** as you make them, into `localStorage`, so the tree at
`/` always shows what the editor shows — in that browser. The status in the
toolbar says so.

**My trees** puts a copy on your account, which is how the work survives this machine.
Save again and it updates the same saved tree rather than piling up copies; **Open**
pulls one back down and makes it the working copy in this browser too.

There are two ways to put a change in front of readers, and a deployment can use
either.

**Publish** writes the working copy to `PUT /api/tree`, and every reader has it on their
next load. It is for a Tribe that needs a citation corrected this afternoon without a
developer. Only the account named in `ADMIN_EMAIL` may publish; anyone may read
`GET /api/tree`, because it serves the same content to the same people the static file
does. **Withdraw** removes it again and readers fall back to the shipped file.

**Export** changes nothing by itself. It downloads a `tree-data.js` for handing the
change to everyone else: replace the file in the repo with it and commit. That is the
route for a deployment whose content belongs in git, reviewed in a diff alongside
everything else.

A reader part-way down the tree keeps the version they started on and gets the new one
next time — the questions are not swapped under a decision in progress. Saved paths are
unaffected either way: each carries the tree it was answered against.

Content precedence, lowest to highest:

1. `tree-data.js` — what the repo ships, and the one hard content dependency the
   reader has. If it does not load, the page says so instead of drawing an empty canvas
2. `/api/tree` — what the editor published, if anything. Fetched after first paint, and
   only adopted if the reader has not started answering
3. a draft saved from `/admin` — that browser only, and it outranks the published tree
   because previewing your own unpublished edit is the point of it
4. a tree opened deliberately from an account (`/?tree=<id>`), or the snapshot inside a
   saved path (`/?run=<id>`) — that reader, that visit

`index.html` used to carry a fifth copy, bundled into the page as a fallback for opening
the file on its own. That stopped being true the day the page started loading
`tree-data.js`, and by the time it was removed its `NODES` had already drifted from the
file that overrides it. A second copy of a legal citation that nobody reads is not a
safety net.

### Who may edit

`ADMIN_EMAIL` names the one account allowed into `/admin`. Set it and the editor
belongs to that person: a visitor who is not signed in meets a gate asking them to,
one signed in as anyone else is told plainly that the editor is someone else's, and
only the named address sees the tree. Sign-in there offers **Continue with Google**
alongside email and password — carrying on as a guest is not offered, because it is
exactly what the gate is refusing. A comma-separated list is accepted for a handover
week, but one address is the intent.

The named account must have a verified address — see
[Set ADMIN_EMAIL in the same breath](#set-admin_email-in-the-same-breath). Leave
`ADMIN_EMAIL` unset on a deployment with a database and nobody can publish. With no
database at all there are no accounts, and the editor works in that browser only, as it
always has.

The editor drops the account chip and the guide link when it is gated: a *Sign in*
button in a toolbar the page will not show you until you have signed in is offering
something already insisted on. What it carries instead is a **Sign out**.

The routes *into* the editor follow the same rule. `/work` shows its **Editor** link,
its *Open in the editor* row action and the editor half of its Trees copy only to the
account that may use them; everyone else gets **Preview**, which reads a saved tree back
in the reader's tree and needs no editor. A link that lands on "this is someone else's"
is a worse answer than no link. Signing in on the tree itself is an ordinary reader
signing in — it has never led to `/admin` and does not now.

**Be clear about what this is.** `/admin` is a page the browser fetches like any other,
so this decides whether the editor is *presented*, not whether the file can be read.
Everything it can actually change is already scoped: it writes to the visitor's own
browser and to their own account, and neither changes what anyone else sees. If the
editor must be genuinely unreachable, put Vercel Deployment Protection on the project,
or take `admin.html` out of the allowlist in `.vercelignore` and run it locally.

Saving to an account is not publishing. A saved tree is that account's copy; the tree
the public sees is the published one, or `tree-data.js` if nothing is published. A saved
tree reaches `/` only when it is opened deliberately, by `/?tree=<id>` or from the
editor.

Anyone with an account can save a tree, and each account sees only its own. This is
storage for a person's working copies, not a shared editorial workflow with review and
approval. If several people need to edit one canonical tree, the seam is still
`tree-data.js` — serve that same JSON shape from an endpoint of your own and the viewer
needs no other change.

## The backdrop

Behind all three pages is one photograph, edge to edge, held at low opacity so card text
keeps its contrast. The repo ships `land.jpg`, a lake at sunset. It is chosen at
**`/admin` → Content → Appearance**, and carried in the content as `THEME`, so it
publishes with everything else:

- the shipped `land.jpg`, an uploaded image, or none (the plain page colour);
- where the image sits vertically, and its opacity in the light and dark themes.

An upload (JPEG, PNG or WebP) is resized in the browser, stored in Postgres, named by
its SHA-256 and served from `/api/media/<hash>` with long-lived caching. That needs a
database, and counts toward the deployment's 25 MB image budget (see [Limits](#limits)).
`look.js` decides what a `THEME` may say — only `land.jpg`, an uploaded image's address,
or nothing — so content can never point the page at another site's image.

If the image fails to load nothing breaks: the page colour shows, and the tool is
complete either way.

**Choosing the image is a decision for the Tribe deploying this, not a default
to be shipped.** A photograph of one nation's country used as decoration on a
tool other nations open makes a claim about whose land it is. Use a photograph the
Tribe owns or has cleared, and check the rights — the file is served publicly
alongside the page.
