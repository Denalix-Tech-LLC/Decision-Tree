/* ===========================================================================
   THE CANVAS VIEW
   Two pages draw a tree on a pannable, zoomable canvas — the reader's at /
   and the editor's at /admin — and both had their own copy of the same two
   pieces of arithmetic. They were identical but for which global held the
   tree's size, which is how the reader and the editor could quietly come to
   disagree about how far off the edge you may drag, or how far you may zoom.

   Only the arithmetic lives here. Everything the two pages genuinely do
   differently — dragging, the wheel, pinch, auto-panning while a card is
   dragged, the parallax the reader page hangs off applyView — stays in the
   page, because it is not the same code and pretending otherwise would cost
   more than the duplication did.

   No dependencies, and nothing here touches the DOM beyond the rect it is
   handed. A page that fails to load this file loses panning limits, not the
   tree, so it is a <script> rather than something to await.
   ========================================================================= */
(function () {
  'use strict';

  var MIN = 0.15,
    MAX = 2;

  /* Hold the canvas so part of the tree is always on screen. Panning used to
     be unbounded, and a scroll or a drag could carry the whole thing into
     empty space with nothing to navigate back by. A tree smaller than the
     stage simply centres on that axis instead. */
  function clamp(view, rect, bounds, margin, topBias) {
    if (!view || !rect || !bounds) return view;
    if (!rect.width || !rect.height) return view;
    var m = margin == null ? 110 : margin;
    var W = bounds.w * view.s,
      H = bounds.h * view.s;
    var loX = rect.width - m - W,
      hiX = m;
    view.tx = loX > hiX ? (rect.width - W) / 2 : Math.min(hiX, Math.max(loX, view.tx));
    var loY = rect.height - m - H,
      hiY = m;
    if (loY > hiY) {
      /* Shorter than the stage. Centred by default; a caller that knows its
         content grows downward passes a topBias — the fraction of the stage
         the content may sit below the top — and gets the spare room left
         underneath instead of split evenly above and below. */
      var mid = (rect.height - H) / 2;
      view.ty = topBias == null ? mid : Math.min(mid, rect.height * topBias);
    } else {
      view.ty = Math.min(hiY, Math.max(loY, view.ty));
    }
    return view;
  }

  /* Zoom about a point, keeping whatever is under that point under it. With
     no point given it is the middle of the stage, which is what a + or −
     button means. */
  function zoom(view, rect, k, cx, cy) {
    if (cx == null) {
      cx = rect.width / 2;
      cy = rect.height / 2;
    }
    var ns = Math.min(MAX, Math.max(MIN, view.s * k));
    var wx = (cx - view.tx) / view.s,
      wy = (cy - view.ty) / view.s;
    view.s = ns;
    view.tx = cx - wx * ns;
    view.ty = cy - wy * ns;
    return view;
  }

  /* The scale that fits a box into a rect, never enlarging past 1:1 — a small
     tree centred at its natural size reads better than a blown-up one. */
  function scaleToFit(rect, bounds, pad) {
    var p = pad == null ? 40 : pad;
    if (!bounds || !bounds.w || !bounds.h) return 1;
    return Math.min(1, (rect.width - p * 2) / bounds.w, (rect.height - p * 2) / bounds.h);
  }

  window.TASView = { clamp: clamp, zoom: zoom, scaleToFit: scaleToFit, MIN: MIN, MAX: MAX };
})();
