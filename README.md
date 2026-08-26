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
| `/graph` | **Tree map** — the entire decision structure at once, pan/zoom, with your path highlighted. |
| `/pathfinder` | **Guided flow** — one question at a time down a vertical spine, with pathway badges. |
| `/wizard` | **Plain wizard** — the simplest step-by-step version. |
| `/review` | **Editorial & regulatory review** of the original source document. |

Every version shares the same corrected logic and citations.

`/` and `/pathfinder` start on load — question 1 is on screen the moment the page
opens, with no splash screen to click through. The "not legal advice" disclaimer that
used to live on that splash is now permanent: a standing strip under the progress rail
on `/`, and the page heading on `/pathfinder`.

## Stack

Pure static HTML. No build step, no dependencies, no framework, no external requests —
each page is a single self-contained file with inlined CSS and JS.

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

Zero build configuration is needed beyond `vercel.json` (clean URLs + security headers).

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
remove options, point an option at any question or ending, create a new
question wired straight to an answer, and edit the pathways and the result
boilerplate. A Checks tab flags options that lead nowhere, questions with no
text, and questions nothing can reach.

Edits **save themselves** as you make them, into `localStorage`, so the tree at
`/` always shows what the editor shows — in that browser. The status in the
toolbar says so.

**Export** does not change anything. It downloads a `tree-data.js` for handing
the change to everyone else: replace the file in the repo with it and commit.

Content precedence, lowest to highest:

1. the copy bundled inside `index.html` — so the file still works standalone
2. `tree-data.js` — what the repo ships
3. a draft saved from `/admin` — that browser only

### Two things to know

`/admin` is not access-controlled. It is a client-side editor: it writes only
to the visitor's own browser and cannot change what anyone else sees, so the
exposure is the UI itself, not the content. If that is not acceptable, put
Vercel Deployment Protection on the project, or drop `admin.html` from the
deploy via `.vercelignore` and run it locally.

There is no server. Saving means `localStorage`; publishing means committing the
export. If you later want real multi-user editing, the seam is `tree-data.js` —
serve that same JSON shape from an API and the viewer needs no other change.
