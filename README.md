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

On `/`, a first-time reader meets the **guide** before the tree: what the tool does,
how to move around the canvas, how to answer and change an answer, what the pathways
mean, what the result and the print-out contain, and how to edit the content. Closing
it is what starts the tree, and the **Guide** button in the top bar reopens it at any
point. A returning reader (`tas-guide-seen` in `localStorage`) lands straight on
question 1. `/pathfinder` still starts on load.

The **Contact** button is available throughout, not only at the end — a reader most
needs a person mid-tree, at the boundary question. It holds who to ask, a month picker
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

## Using a photograph as the horizon

Drop an image named `land.jpg` beside `index.html` and it becomes the horizon on
both the tree and the editor. `.png` and `.webp` work too — change the filename
in the `.env .photo` rule.

If no such file exists nothing breaks: the background simply does not paint and
the drawn ridgelines show through, so the page is complete either way.

The image is treated rather than dropped in raw — masked away toward the top
where the cards sit, desaturated toward the brand neutrals, held at low opacity
(`--photo-op`, .34 light / .2 dark), and covered by a gradient scrim. Card text
measured 15.99:1 with the image in place, unchanged from without it. Tune
`--photo-op` if it reads too strong or too faint.

**Choosing the image is a decision for the Tribe deploying this, not a default
to be shipped.** A photograph of one nation's country used as decoration on a
tool other nations open makes a claim about whose land it is; the drawn
ridgelines are deliberately region-neutral for that reason. Use a photograph the
Tribe owns or has cleared, and check the rights — the file is served publicly
alongside the page.
