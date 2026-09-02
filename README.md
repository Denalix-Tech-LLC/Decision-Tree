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
wraps there and the words would sit over the standing notice. It holds who to ask, a month picker
and a slot list that compose a meeting request, and an optional scheduling link. The
request opens in the reader's own mail program with the decision path attached if they
want it; nothing is posted anywhere from the page.

The five contact fields ship **empty**, and the panel says so plainly rather than
naming anyone. Fill them in at `/admin` → **Content → Contact** and export before the
tool is shared. Until an email address is set, the panel offers *Copy email text*
instead of *Send request*. The scheduling link takes any URL — Calendly, Bookings,
anything — and reveals a **Book a time** button when it is set.

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
(`?purge=1&confirm=1`), and closing an account needs both the password and the word
`DELETE`. There is no undo past that point and no backup — the dialog says so.

An account is a place to keep work and nothing more. It is not a submission to EPA, it
is not visible to anyone else, and nobody is notified when it is used. The tool sends
no email: there is no address-verification step and no password-reset link, because
there is no mail path and inventing one would be a bigger promise than this deployment
can keep. Someone with database access resets a forgotten password instead:

```bash
node scripts/admin-user.mjs passwd someone@example.org 'a new long passphrase'
```

The same script lists accounts, shows what one holds, signs a person out everywhere,
and deletes an account with its work. It is the whole of the administration story, and
it is deliberately not a page on the site.

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

The two ways in meet on a **verified** email address. If a Google account's address
matches an account someone registered with a password, the two are joined rather than
duplicated — it is the same person, and Google has verified the address, which is what
makes joining on it safe and would not be safe on an unverified one. An account created
through Google has no password, and **Account settings** offers to set one so nobody is
locked to a single route; the same panel attaches or detaches a Google account, and
refuses to detach the only way in. Typing a password for a Google-only account gets
told to use the button rather than a wrong-password message it could never satisfy.

There is no password reset by email, for either route — see below.

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

The API is Vercel serverless functions under `/api`, written in plain Node ESM. One
runtime dependency — `pg` — and no build step. Passwords are hashed with `scrypt` from
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
  health.js                         is storage there, and does the schema exist yet
  tree.js                           the content readers are served: GET, and PUT to publish
  auth/         register login logout me password sessions account
  auth/google/  start callback unlink      sign in with Google, when configured
  trees/ runs/ documents/           index.js (list, create), [id].js (read, change, delete)
  _lib/         db schema auth records crud http google
dev-server.mjs                      static + functions locally, no Vercel CLI
scripts/                            db:init  db:prune  selftest  check  admin-user
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
signed by a chain Node does not carry. Set `PGSSLMODE=verify-full` once the provider's
CA is in the trust store.

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` go in the same place if you want the
Google button; leaving them out is a complete configuration, not a missing one. Add
each deployment's `/api/auth/google/callback` to the authorised redirect URIs — preview
deployments included, if accounts are on there too.

Housekeeping is optional and can go on cron:

```bash
npm run db:prune -- --trash 90
```

Expired sessions and stale login attempts always go; `--trash 90` also purges work that
has been in someone's deleted list for over 90 days.

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
- Boundary risk is to the **scope of recognized CAA regulatory jurisdiction**, not land title
- Decision logic: the boundary question is phrased so risk-weighing attaches to
  *disputed* boundaries (the source document had these branches inverted)

`<meta charset="utf-8">` is declared in every file — without it, servers that don't
send a charset mangle every em-dash, curly quote and `§`.

## Editing the tree

The questions, options, pathways and result content live in `tree-data.js`.
Edit it by hand, or visually at **`/admin`**.

The editor draws the whole tree — every question with its options fanned
beneath it — and you edit by clicking a card. You can retitle anything, add or
remove options, point an option at any question or ending, and edit the pathways,
the result boilerplate, the seven disclaimers and the contact details. A Checks tab
flags options that lead nowhere, questions with no text, and questions nothing can
reach.

The guide copy is bundled in `index.html` rather than in `tree-data.js`, because it
describes how the tool behaves rather than what it recommends — but it does quote the
four pathway names and the result panel's running order, so renaming a pathway at
`/admin` puts the guide out of date and the editor cannot warn you.

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

Leave `ADMIN_EMAIL` unset and the editor stays open to anyone who reaches it, which is
how this tool worked before accounts existed and how a deployment with no database has
to keep working.

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
or drop `admin.html` from the deploy via `.vercelignore` and run it locally.

Saving to an account is not publishing. A saved tree is that account's copy; the tree
the public sees is still what `tree-data.js` ships, so publishing still means
**Export** and a commit. Content precedence at `/` is unchanged, with the account
sitting alongside rather than above: the bundled copy, then `tree-data.js`, then this
browser's draft — and a saved tree only when one is opened deliberately, by
`/?tree=<id>` or from the editor.

Anyone with an account can save a tree, and each account sees only its own. This is
storage for a person's working copies, not a shared editorial workflow with review and
approval. If several people need to edit one canonical tree, the seam is still
`tree-data.js` — serve that same JSON shape from an endpoint of your own and the viewer
needs no other change.

## The sunset

The backdrop is a sunset, drawn rather than photographed: cool dusk overhead, a mauve
band, then the sun's own band and gold at the horizon, with layered ridgelines
darkening as they come near and a sun sitting on the nearest of them. It moves with the
theme — after dark it is the last of the light behind black ridges — and it is the same
on `/`, `/admin` and `/work`, so the three read as one tool.

Every colour in it is a mix of a brand colour with a brand neutral, the way the card
tints are; the tokens are `--sky-top`, `--sky-mid`, `--sky-glow`, `--sky-bot`,
`--ridge-1/2/3`, `--haze`, `--cloud` and `--mote`, and retuning the scene means editing
those and nothing else. The two exceptions are the sun's own `--sun-core` and
`--sun-halo`, which are brighter than the palette allows because they are a light
source rather than a surface — the same exception the arrival bloom already took.

Cards keep the neutral surfaces, so nothing behind the sunset changes the contrast of
text sitting on top of it. The sun sits at 64% across on the tree and at 34% in the
editor, because the editor keeps an inspector down its right-hand side and 64% there is
behind a panel. `--halo`, the wide stroke drawn under each limb of the tree,
is the one thing that had to follow the sky: it used to be the page background, which
read as a cold outline once the sky went warm.

## Using a photograph as the horizon

Drop an image named `land.jpg` beside `index.html` and it becomes the horizon on
both the tree and the editor. `.png` and `.webp` work too — change the filename
in the `.env .photo` rule.

If no such file exists nothing breaks: the background simply does not paint and
the drawn ridgelines show through, so the page is complete either way.

The image is treated rather than dropped in raw — masked away toward the top
where the cards sit, warmed toward the sunset behind it, held at low opacity
(`--photo-op`, .34 light / .2 dark), and covered by a gradient scrim in `--sky-bot`. Card text
measured 15.99:1 with the image in place, unchanged from without it. Tune
`--photo-op` if it reads too strong or too faint.

**Choosing the image is a decision for the Tribe deploying this, not a default
to be shipped.** A photograph of one nation's country used as decoration on a
tool other nations open makes a claim about whose land it is; the drawn
ridgelines are deliberately region-neutral for that reason. Use a photograph the
Tribe owns or has cleared, and check the rights — the file is served publicly
alongside the page.
