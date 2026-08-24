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

## Stack

Pure static HTML. No build step, no dependencies, no framework, no external requests —
each page is a single self-contained file with inlined CSS and JS.

## Deploy

```bash
npx vercel --prod
```

First run will prompt you to log in and link the project. Zero configuration is needed
beyond `vercel.json` (clean URLs + security headers).

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
