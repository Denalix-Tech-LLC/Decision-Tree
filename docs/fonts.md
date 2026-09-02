# Self-hosting the brand fonts

The page makes zero external requests, so the four licensed families are wired
by name with system stand-ins behind them. Drop the real files in and they take
over with no other change.

1. Put woff2 files next to `index.html` (or in `/fonts`).
2. Paste this at the very top of the `<style>` block in `index.html`:

```css
@font-face{font-family:"Morvi";src:url(fonts/morvi.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"Gotham Book";src:url(fonts/gotham-book.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"Gotham Book";src:url(fonts/gotham-medium.woff2) format("woff2");font-weight:600;font-display:swap}
@font-face{font-family:"Marion";src:url(fonts/marion-regular.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"Marion";src:url(fonts/marion-bold.woff2) format("woff2");font-weight:600;font-display:swap}
@font-face{font-family:"Dongra Script";src:url(fonts/dongra-script.woff2) format("woff2");font-weight:400;font-display:swap}
```

Current stand-ins, in order of preference:

| Role | Brand face | Falls back to |
|---|---|---|
| Display (all-caps) | Morvi | Haettenschweiler → Arial Narrow → Impact |
| UI / labels | Gotham Book | Montserrat → Century Gothic → Avenir Next → system-ui |
| Body / questions | Marion Regular | Georgia → Iowan Old Style → Palatino |
| Accent script | Dongra Script | Segoe Script → Brush Script MT |

Dongra is not wired in at all. The guide reserves it for pull-quotes and this
page has none, so the token was removed rather than left sitting unused — add
`--script` back alongside the `@font-face` if a quote ever appears.

Note: web use of Gotham and Morvi needs a webfont licence. Confirm the licence
covers this deployment before shipping the real files.
