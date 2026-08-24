# Prompt — Build a live, visualized, interactive TAS decision tree (web)

> Copy everything below the line into Claude (or any capable coding AI). It is self-contained.

---

## Role
You are a senior front-end engineer and information designer. Build a **live, interactive, visually-rendered decision tree** as a web app that helps a federally recognized Tribe decide **whether — and for which Clean Air Act (CAA) sections — to seek "Treated as a State" (TAS)** status.

## What to build
A single, self-contained **`index.html`** file (all HTML/CSS/JS inline, **no external network requests, no CDN**, works offline by double-click). It must render the **entire decision tree as a visual graph** (nodes connected by labeled edges) AND let the user navigate it live.

Do **not** build a plain form/wizard only. The centerpiece is the **visualized tree** — the user sees the branching structure and interacts with it directly.

## Core interactions (the "live" part)
1. **Visual graph.** Auto-lay-out the tree from a data object (compute node positions from the data — do not hard-code coordinates). Top-to-bottom or left-to-right. Nodes = questions & outcomes; edges are **labeled with the answer** ("No — clear", "Yes — disputed", "Many", etc.).
2. **Pan & zoom** (drag to pan, wheel/pinch to zoom, plus zoom-in/out/fit-to-screen buttons).
3. **Click to choose.** Clicking a node's answer advances the path: the **route from the root to the current node is highlighted**, off-path nodes dim. A running **breadcrumb** shows the chosen answers.
4. **Detail panel.** Selecting any node opens a side/bottom panel with its full detail — help text, risk notes, and the recommended **CAA sections as chips**, plus any implementation options.
5. **Guided mode toggle.** A "Step me through it" mode reveals one question at a time while simultaneously highlighting the current position on the visual tree, so the map and the wizard stay in sync.
6. **Reset** button, and a **Print / Save-as-PDF** button that outputs a clean summary of the chosen path + recommended sections + next steps.

## Node types (style each distinctly)
- **Decision** (a question), **Risk/Warning** (boundary-risk callout), **Outcome/Terminal** (a recommended pathway).

## The exact decision-tree content (use verbatim; this logic is already corrected — do not "fix" it back)

**Root:** "Should our Tribe seek TAS under the Clean Air Act — and for what?"

**Q1 — Boundaries:** "Are any of the Tribe's jurisdictional boundaries disputed?"
- **No — boundaries are clear** → proceed to Q2 (risk: low).
- **Yes — some or all are disputed** → go to Q1b.
- **Not sure** → go to Q1b (treat cautiously).

**Q1b — Boundary-risk choice** (only reachable from disputed/unsure). Show this RISK note first:
> "When you apply for TAS, EPA must provide your application and boundary showing to the appropriate state and local air agencies (the appropriate governmental entities). They may comment and, after approval, challenge the boundaries in court. An adverse ruling could **narrow the CAA regulatory jurisdiction EPA recognizes** for the Tribe. This does **not** affect land title or ownership. Coordinate closely with Tribal counsel and Council."
- **Pursue TAS for undisputed areas only** (affirm disputed areas remain claimed but excluded) → Q2.
- **Pursue TAS for the full claimed area** (accept litigation risk) → Q2.
- **Don't pursue TAS right now** → Outcome: **Non-TAS pathways**.

**Q2 — Sources:** "How many air-pollution sources are within your jurisdiction?"
- **Many** → Outcome: **Regulatory TAS (primary authority)**; continue to Q3.
- **A few / a localized issue** → Outcome: **Targeted Regulatory TAS**; continue to Q3.
- **None or very few** → continue to Q3 (no own-source regulatory outcome).

**Q3 — Good neighbor:** "Do outside sources affect your air, or do you want a formal voice in nearby permits and plans?"
- **Yes** → Outcome: **Participatory 'good-neighbor' TAS**; continue to Q4.
- **No** → continue to Q4.

**Q4 — Capacity:** "Do you have the capacity to run an air program?"
- **Yes, ready** → (no add-on).
- **Not yet / building** → Outcome add-on: **Capacity-building options**.
- **Unsure** → Outcome add-on: **Capacity-building options**.

> Note: Regulatory and Participatory TAS are **not mutually exclusive** — a Tribe can receive both outcomes. Compose the final result from every outcome the path collected.

## Outcome content (show CAA sections as chips)
1. **Regulatory TAS — be the primary implementing authority.** Two implementation modes, shown side by side:
   - *Develop your own programs → EPA approval:* you tailor the rules and are the primary enforcer; once approved they are federally enforceable.
   - *Take delegation of federal rules (40 CFR part 71):* no rule-writing; you permit & inspect; enforcement is referred to EPA. A good capacity-building first step.
   - Sections: §110 TIP · O₃ plans §§181–185 · PM plans §§188–189 · SO₂/NO₂/Pb §§191–192 · CO plans §§186–187 · Regional haze §169A · PSD §165 · NSR §173 · §167 enforcement · Title V §§501–507 · §111 NSPS · §112 air toxics · §114 records · §129 solid-waste combustion · §303 emergency powers.
2. **Targeted Regulatory TAS** — for a few/localized sources (e.g., a wood-smoke burning ordinance): §110 TIP · PM NAAQS.
3. **Participatory "good-neighbor" TAS** — early review of and standing to comment on others' plans/permits: §126(a)/(b) · §110(a)(2)(D)(i) · §505(a) · §105 grants · §319 monitoring · §107(d) designations.
4. **Non-TAS pathways** — inherent Tribal authority (run programs without EPA approval); §103 (investigative) and §105 (programmatic, via a **Performance Partnership Grant, PPG**) grants — note §105 **without** TAS carries the standard 40% match, whereas TAS reduces it to 5% (then up to 10%); direct programs: monitoring, environmental education, indoor-air, radon.
5. **Capacity-building** — submit a capability plan (show EPA how you'll build expertise); take delegation instead of writing rules; phase the program (a few sections now, more later); partner or form a consortium with neighboring Tribes.

## Always show on the result
- **The four eligibility criteria** as a checklist (40 CFR §§ 49.6 / 49.7): (a) federal recognition; (b) a governing body carrying out substantial duties; (c) a jurisdictional showing — reservation: map + legal description of exterior boundaries; off-reservation: a statement of legal counsel on the basis for jurisdiction; (d) reasonable capability, **or a plan to build it**. You may reuse documentation from a prior TAS approval per § 49.7(a)(8).
- **Next steps:** bring the result to leadership/Council/counsel; assemble the jurisdictional showing; document the governing body and capability (or a plan); contact your EPA Regional Office Tribal air lead (or OAQPS); review the detailed CAA-section summary before finalizing.
- **Reference links** (plain `<a target="_blank" rel="noopener">`, not fetched): EPA "CAA: Summary of content & applicability for TAS (Titles I, III, V)" and "Tribal Authority Rule (TAR) under the Clean Air Act."

## Accuracy guardrails (must be exactly these)
Regional haze = **§169A** (never "169(a)(1)"). Title V = **§§501–507** (never "500"). §129 = **solid-waste combustion** (not "landfill"). **Performance** Partnership Grant (not "Program Partnership Group"). Risk = **narrowing recognized CAA regulatory jurisdiction** (never "land base in jeopardy"). Use "appropriate governmental entities" and "40 CFR part XX".

## Design direction
Professional, environmental/governmental but warm — not a templated look. Considered palette (a cool paper neutral with a pine/teal accent works well); a characterful serif for display headings paired with a clean sans for UI and a mono face for section citations. Clear node cards; legible edge labels; strong emphasis on the active path. Avoid generic "AI default" styling (cream + terracotta, purple-blue gradient hero, emoji section markers).

## Technical & quality bar
- **Data-driven:** define the whole tree as one editable JS object/JSON (nodes, edges, answer labels, outcomes) and render everything from it, so the content can be edited without touching layout code. Example shape (indented, adapt as needed):

        const TREE = {
          id: "root",
          type: "decision",
          title: "…",
          help: "…",
          answers: [ { label: "No — clear", to: "q2" }, … ]
        }
        // plus a nodes map keyed by id, and outcome definitions with { title, body, sections:[…], options:[…] }

- Render nodes/edges with **inline SVG** (or Canvas) and compute layout in JS; do not depend on any external graph library. If you use one, it must be fully inlined/vendored.
- **Responsive:** the graph pans/zooms on mobile; the page body never scrolls sideways; panels reflow.
- **Theme-aware (light + dark):** define colors as CSS custom properties; support `prefers-color-scheme` and paint an explicit background — never leave a color defined only inside a media/theme block.
- **Accessible:** full keyboard navigation (Tab/Enter/arrow keys to traverse nodes and pick answers), visible focus states, ARIA roles/labels for the graph and panels, and honor `prefers-reduced-motion`.
- Clean, commented, single file. No console errors.

## Important guardrails
This is a **decision-support / planning tool, not legal advice**, and it is **not an official EPA product**. Do **not** use EPA logos, seals, or branding, and do not imply EPA authorship. Include a visible "general information, not legal advice — confirm citations against 40 CFR Part 49 and consult Tribal counsel" disclaimer.

## Acceptance criteria (self-check before finishing)
1. The full tree renders as a visible, pannable/zoomable graph with answer-labeled edges.
2. Clicking answers highlights the root→node path and dims the rest; breadcrumb updates.
3. A node's detail panel shows help, risk notes, and CAA section chips.
4. The final result correctly composes multiple outcomes (e.g., Regulatory **+** Participatory) and shows the eligibility checklist, next steps, and links.
5. Guided mode and graph mode stay in sync.
6. Every accuracy guardrail above is met.
7. Works offline as one file; responsive; light/dark; keyboard-accessible; no console errors.

Deliver the complete `index.html` in one block, then give a 3–4 line summary of how the tree data is structured so I can edit questions later.
