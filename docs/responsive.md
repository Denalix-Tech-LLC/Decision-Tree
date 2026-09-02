# Checking the layout at every size

`scripts/responsive.js` is the check. Load it into a page and call `TASRESP()`;
it returns `{size, ok, fails}`. It asserts the things a layout must not break
whatever the content says, rather than comparing screenshots — a decision tree's
pixels change every time a question is reworded, and a test that cries wolf gets
turned off.

What it asserts:

| | |
|---|---|
| the page never scrolls sideways | `scrollWidth` against the viewport |
| nothing in the page's furniture is off either edge | buttons, links, fields — excluding cards on the canvas, which are pannable by design |
| nothing is too small to tap | under 24px tall |
| no card is wider than the canvas holding it | catches a layout built for a wider screen |
| the open question and *its own* answers are on screen | not the whole tree: four levels deep is wider than a phone on purpose |
| a drawing shorter than the canvas is not adrift in it | catches a lone question centred in an empty sky |
| no text under 10.5px | |
| the standing notice is present and visible | the one line that must never be lost |

## Running it

In a browser console on any page:

```js
fetch('/scripts/responsive.js').then(r=>r.text()).then(eval).then(()=>TASRESP())
```

Then resize and call `TASRESP()` again. On `/`, call `relayout()` first: the tree
decides its card widths when it is built, and some harnesses change the viewport
without firing `resize` or `ResizeObserver`, so the page never learns to redraw.
A real browser fires both and needs no prompting.

Paste it into a console on an actual phone too. An emulated viewport cannot show
you a soft keyboard, a notch, or a browser bar that slides away.

## Sizes worth covering

320×568 · 360×740 · 375×812 · 414×896 — phones, smallest first
768×1024 · 1024×768 · 1180×820 — tablets, both orientations
812×375 — a phone on its side, the shortest canvas there is
1280×800 · 1440×900 · 1920×1080 — laptops and desktops

Check `/` twice at each: once at question one, once with the tree grown to a
result. They fail differently — a fresh tree can be adrift in empty space, and a
grown one can be built for the wrong width.

## What the tree does with a narrow screen

The cards are not a fixed size. `questionW()` and `optionW(n)` in `index.html`
measure the fan against the stage: three answers share the width available, down
to a floor of 92px, and the gap between them tightens from 18px to 8px below
440px. A question with two answers stays wide on a phone; one with five narrows.
It is the same fan on every screen rather than a separate mobile layout.

`relayout()` redraws when the widths the screen calls for no longer match the
ones on the canvas — on `resize`, on `orientationchange`, from a `ResizeObserver`
on the stage, and, as a backstop, at the end of a pan and on coming back to the
tab.
