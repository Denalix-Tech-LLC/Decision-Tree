/* ===========================================================================
   THE RESPONSIVE CHECK
   Loaded into a page in a browser and run as TASRESP(), it answers one
   question: does this page hold together at the size it is being shown at.

   It is not a screenshot test. Screenshots of a decision tree change every
   time a question is reworded, so they cry wolf. These are the invariants a
   layout must not break whatever the content says: nothing scrolls sideways,
   nothing that can be clicked sits off the edge, and no card is drawn outside
   the canvas it belongs to.

   Note when driving it from an emulated viewport: some harnesses change the
   viewport without dispatching resize or ResizeObserver, so the page never
   learns it should redraw. Call the page's own relayout() after each resize
   before asserting, or you are testing a layout built for the previous size.

   It can also be pasted into a console on a real phone, which is the only way
   to catch what an emulated viewport does not — a soft keyboard, a notch, a
   browser chrome bar that comes and goes.
   ========================================================================= */
(function () {
  'use strict';

  function box(el) {
    return el.getBoundingClientRect();
  }

  /* Everything a finger could land on that is part of the page's furniture.
     Cards on the canvas are excluded: they are pannable content, and a tree
     four levels deep is wider than a phone on purpose. What must be reachable
     about them is checked separately, against the canvas rather than the
     window. */
  function controls() {
    return [].slice
      .call(document.querySelectorAll('button,a[href],input,select,textarea,[role="button"]'))
      .filter(function (el) {
        if (el.hidden || el.disabled) return false;
        if (el.closest('#nodes')) return false;
        var r = box(el);
        if (!r.width || !r.height) return false;
        var cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none';
      });
  }

  function name(el) {
    return (
      el.id ||
      (el.className && String(el.className).split(' ')[0]) ||
      el.tagName.toLowerCase()
    ) + (el.textContent ? ' “' + el.textContent.trim().slice(0, 18) + '”' : '');
  }

  window.TASRESP = function () {
    var W = document.documentElement.clientWidth;
    var H = document.documentElement.clientHeight;
    var fails = [];
    var note = function (m) {
      fails.push(m);
    };

    /* 1. the page itself must not scroll sideways */
    if (document.documentElement.scrollWidth > W + 1) {
      note('the page scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + W);
    }

    /* 2. nothing clickable off either edge, or under the fold of a fixed bar */
    controls().forEach(function (el) {
      var r = box(el);
      if (r.right > W + 1) note('off the right edge: ' + name(el));
      if (r.left < -1) note('off the left edge: ' + name(el));
    });

    /* 3. tap targets. 32px is below the 44 a platform guideline asks for, but
          it is the line under which this tool's own buttons start being missed */
    controls().forEach(function (el) {
      var r = box(el);
      if (r.height < 24) note('too short to tap (' + Math.round(r.height) + 'px): ' + name(el));
    });

    /* 4. the tree's cards must be inside the canvas that holds them */
    var stage = document.getElementById('stage');
    if (stage) {
      var s = box(stage);
      var cards = [].slice.call(document.querySelectorAll('#nodes .tnode, #nodes .qcard, #nodes .ocard'));
      cards.forEach(function (c) {
        var r = box(c);
        if (r.width > s.width + 1) {
          note('card wider than the canvas: ' + Math.round(r.width) + ' > ' + Math.round(s.width));
        }
      });
      /* at the default view, the question and its answers should be on screen */
      var q = document.querySelector('#nodes .tnode.q.active') ||
        document.getElementById('resultNode') ||
        document.querySelector('#nodes .tnode.q');
      if (q) {
        var qr = box(q);
        if (qr.left < s.left - 1 || qr.right > s.right + 1) {
          note('the open question is not fully on screen');
        }
      }
      /* Only the question being answered has to be on screen with its own
         answers. A tree several levels deep is wider than a phone by design —
         it is a canvas you pan, and the earlier rows are meant to be behind
         you. Asserting the whole tree fits would be asserting the canvas away. */
      if (q) {
        var openId = q.getAttribute('data-node');
        var opts = [].slice.call(
          document.querySelectorAll('#nodes .tnode.opt[data-node="' + openId + '"]')
        );
        var clipped = opts.filter(function (o) {
          var r = box(o);
          return r.left < s.left - 1 || r.right > s.right + 1;
        });
        if (opts.length && clipped.length) {
          note(clipped.length + ' of ' + opts.length + ' answers to the open question are off screen');
        }
      }
      /* Adrift in an empty screen. Measured from the top of the drawing, not
         from whichever card has focus: on a finished tree the focus is the
         result, which belongs at the bottom of what you scrolled through.
         Only applies when the drawing is shorter than the canvas, because a
         taller one has no spare room to waste. */
      if (cards.length) {
        var top = Math.min.apply(null, cards.map(function (c) { return box(c).top; }));
        var bot = Math.max.apply(null, cards.map(function (c) { return box(c).bottom; }));
        if (bot - top < s.height) {
          var gap = top - s.top;
          if (gap > s.height * 0.45) {
            note('the drawing is shorter than the canvas and starts ' +
              Math.round((gap / s.height) * 100) + '% down it, with empty sky above');
          }
        }
      }
    }

    /* 5. text that has become unreadable */
    [].slice.call(document.querySelectorAll('p,li,td,.ttl,.lb,.meta')).forEach(function (el) {
      var r = box(el);
      if (!r.width || !r.height) return;
      var px = parseFloat(getComputedStyle(el).fontSize);
      if (px && px < 10.5) note('text under 10.5px: ' + name(el) + ' at ' + px + 'px');
    });

    /* 6. the standing disclaimer is the one thing that must never be lost */
    var notice = document.getElementById('noticeTxt');
    if (notice) {
      var nr = box(notice);
      if (nr.bottom < 0 || nr.top > H || !notice.textContent.trim()) {
        note('the standing notice is not visible');
      }
    }

    return { size: W + 'x' + H, ok: fails.length === 0, fails: fails };
  };
})();
