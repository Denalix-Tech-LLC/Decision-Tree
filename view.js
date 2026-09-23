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
    MAX = 2,
    /* the most one wheel event may zoom by — a mouse notch, as it always was */
    STEP = 1.12;

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
     button means.

     `floor` is the smallest scale this zoom may take — see floorFor(). It
     never pushes the scale UP: a reader already below it (Fit on a very tall
     tree goes lower on purpose) can still zoom in smoothly from where they
     are, and simply cannot go any further out. */
  function zoom(view, rect, k, cx, cy, floor) {
    if (cx == null) {
      cx = rect.width / 2;
      cy = rect.height / 2;
    }
    var lo = floor == null ? MIN : Math.max(MIN, Math.min(floor, view.s));
    var ns = Math.min(MAX, Math.max(lo, view.s * k));
    var wx = (cx - view.tx) / view.s,
      wy = (cy - view.ty) / view.s;
    view.s = ns;
    view.tx = cx - wx * ns;
    view.ty = cy - wy * ns;
    return view;
  }

  /* One wheel event, as a zoom factor.

     A mouse wheel sends a few events per notch, each with a large deltaY. A
     two-finger trackpad pinch arrives as ctrl+wheel too, but as dozens of
     events each with a tiny one. Both pages used to apply a fixed 12% per
     event, which is right for the mouse and wildly wrong for the trackpad:
     a gentle pinch of twenty events is 0.89^20 = 0.10, so the tree was
     flung to the floor by a gesture that meant "a little smaller".

     Scaling by the size of the delta makes the gesture proportional to how
     far the fingers move. Capping each event at STEP leaves a mouse notch
     exactly where it was. deltaMode 1 is lines (Firefox), 2 is pages. */
  function wheelFactor(e) {
    var dy = e.deltaY || 0;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= 400;
    var k = Math.exp(-dy * 0.01);
    return Math.min(STEP, Math.max(1 / STEP, k));
  }

  /* The smallest scale worth zooming out to: the one that shows the whole
     tree. Past that point nothing more comes into view — the cards only
     shrink, into empty space — and that is where a pinch used to end.

     Bounded on both sides. `lo` stops a very large tree from licensing a
     floor too small to read; Fit is the way to see all of one of those, and
     Fit sets the scale directly rather than zooming. `hi` lets a small tree
     still be zoomed out a little, rather than refusing to move at all. */
  function floorFor(rect, bounds, pad, lo, hi) {
    var a = lo == null ? 0.3 : lo,
      b = hi == null ? 0.75 : hi,
      p = pad == null ? 40 : pad;
    if (!rect || !bounds || !bounds.w || !bounds.h || !rect.width || !rect.height) return a;
    var fit = Math.min((rect.width - p * 2) / bounds.w, (rect.height - p * 2) / bounds.h);
    return Math.min(b, Math.max(a, fit));
  }

  /* Only what a page calls. Fit is each page's own (the reader and the editor
     frame a tree differently), and MIN / MAX stay in here: a page that wants
     a different floor passes one to zoom() rather than reading these. */
  window.TASView = {
    clamp: clamp,
    zoom: zoom,
    wheelFactor: wheelFactor,
    floorFor: floorFor,
  };
})();
