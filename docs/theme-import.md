# Prompt to run in your colleague's repo

Copy everything below the line into Claude Code **in your colleague's project**.
It writes a single file, `theme-export.md`, which you bring back here.

---

You are documenting this project's visual design system so that a page built
elsewhere can be **rewritten to look native here** before being merged in as an
additional route.

This is one-way and read-only. This project is the authority. Do not change any
code in this repo, do not adopt anything from the incoming page, and do not
propose changes to this project's design. Your only output is one new file,
`theme-export.md`. The incoming page will be conformed to whatever you document
— so document what is actually true here, not what would be ideal.

## 1. Find the real source of truth

Search the repo, in this order, and say which you found:

- Tailwind: `tailwind.config.{js,ts,cjs,mjs}` (`theme.extend.colors`, `fontFamily`,
  `borderRadius`, `boxShadow`, `spacing`), plus `@theme` blocks if Tailwind v4
- CSS custom properties: `:root`, `[data-theme]`, `.dark`, `@media (prefers-color-scheme)`
- CSS-in-JS / MUI / Chakra theme objects, `createTheme`, `extendTheme`
- Sass/Less variables, `_variables.scss`, design-token JSON (`tokens.json`, Style Dictionary)
- shadcn/ui `globals.css` HSL triplet variables
- Any `DESIGN.md`, `STYLEGUIDE.md`, Storybook theme, or Figma token export

Resolve values to their **final computed form**. If a colour is
`hsl(var(--primary))` or `theme.colors.brand.600`, chase it to the actual hex or
hsl. Never report an alias as a value. If two sources disagree, report the one
the running app actually uses and note the conflict.

## 2. What to record

For **light and dark** (if dark exists — say so explicitly if it does not):

- **Colour roles**, with hex/hsl for each: page background, secondary/raised
  background, card/surface, primary text, secondary/muted text, tertiary/faint
  text, border, strong border, brand/primary accent, accent hover or secondary
  accent, accent tint/subtle background, accent text-on-tint, text colour that
  goes ON the accent, plus semantic success / warning / danger and their tint
  backgrounds and border colours.
- **Typography**: exact font stacks including fallbacks; whether webfonts are
  self-hosted or CDN, and the `@font-face` or import lines; the type scale with
  sizes/weights/line-heights for h1–h4, body, small, and any mono/label style;
  letter-spacing conventions.
- **Shape and depth**: border radii (name → px) and which is the default for
  cards vs buttons vs inputs; border widths; the full box-shadow ladder verbatim.
- **Spacing**: the base unit and scale; standard card padding; page gutters;
  max content width.
- **Motion**: standard durations and easing curves.
- **Focus ring**: exact treatment, since this must match for accessibility.
- **Chrome**: how the app's header/nav/sidebar is built — height, background,
  border, and whether an additional page is expected to render inside a shared
  layout or as a full-bleed standalone route.

## 3. How the theme is switched

State precisely how dark mode is toggled: a `data-theme` attribute, a `.dark`
class on `<html>` or `<body>`, `prefers-color-scheme` only, or a JS/context
provider. Give the exact selector. Also state whether a theme class is required
on a wrapper element for descendants to inherit correctly.

## 4. Component recipes — the part that actually makes it look native

Colours alone will not make the page match. For each of the following, quote the
**real CSS or component code** from this repo (with `path:line`), so the incoming
page can adopt the same treatment verbatim rather than approximating it:

- **Card / panel**: border vs shadow vs both, radius, padding, background, and
  what changes on hover.
- **Button**: primary, secondary, and ghost/tertiary — padding, radius, weight,
  border, hover and active states, and disabled.
- **Headings**: font, weight, size, letter-spacing, and margin rhythm.
- **Small labels / eyebrows / badges / pills / chips**: case, tracking, size,
  colour, background.
- **Input and select**, if the project has them.
- **Link** styling, including hover.
- **Table or list rows**, if present.
- **Focus-visible** ring, exactly.
- **Icons**: which set, stroke width, standard sizes.

Also state the **house voice** conventions: sentence case vs title case for
headings and buttons, whether labels are uppercased, how numbers and dates are
formatted, and whether the tone is terse or explanatory.

## 5. Token mapping

The incoming page is one self-contained HTML file that drives everything from
the CSS custom properties below. Give this project's equivalent for each, with
the resolved light and dark value, so the page can be re-pointed at your system:

`--bg` `--bg-2` `--surface` `--surface-2` `--ink` `--muted` `--faint`
`--accent` `--accent-2` `--accent-soft` `--accent-ink` `--on-accent`
`--border` `--border-strong`
`--good` `--good-bg` `--good-line` `--risk` `--risk-bg` `--risk-line`
`--alert` `--alert-bg`
`--serif` `--sans` `--mono`
`--sh1` `--sh2` `--ease`

Where this project has no equivalent, say `NO EQUIVALENT` and give the value
this project would use instead — chosen from the existing palette, never
invented, and never carried over from the incoming page. Flag any mapping where the resulting text-on-background contrast
would fall below **4.5:1**, and give the measured ratio — the incoming page
carries small 11.5px legal text, so this matters.

Note: `--serif` is used for headings and `--mono` for small uppercase labels. If
this project is sans-only, say so and recommend what those two should become.

## 6. Deliver

Write `theme-export.md` containing:

1. **Summary** — the design system in five lines: where tokens live, how dark
   mode switches, the font strategy, the radius/shadow character, and the single
   most distinctive visual trait someone must copy to look native here.
2. **A paste-ready CSS block** — two `:root`-style blocks (light and dark) that
   define *the incoming page's* token names using this project's values, written
   against this project's actual dark-mode selector.
3. The component recipes from section 4 and the mapping table from section 5.
4. **Conventions to honour** — anything that would make a new page look foreign:
   uppercase labels, sentence vs title case, icon set and size, button shape,
   whether cards use borders or shadows or both, data/number formatting.
5. **Gotchas** — CSS resets, global selectors, `!important` rules, z-index
   ranges already in use, stacking contexts, or anything that would collide with
   a full-viewport page that uses `position:fixed` backdrops, CSS 3D transforms
   (`perspective`, `preserve-3d`), and its own pan/zoom wheel handling.
6. **Assets** — any logo/wordmark/icon a page in this project is expected to
   show, and their paths.

Quote real values from real files and cite `path:line` for each. Do not invent a
token that does not exist, and do not tidy or normalise the palette — report it
as it is, including inconsistencies, since matching the real thing is the goal.
