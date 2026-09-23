/* Parse-check the inline scripts in every HTML page.

     node scripts/check-html.mjs

   The pages carry their JavaScript inline, so a syntax error in one of them
   is invisible to `node --check` and shows up as a blank page instead. This
   pulls each <script> block out and parses it the way the browser would.
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const files = process.argv.slice(2);
const pages = files.length
  ? files
  : fs
      .readdirSync(process.cwd())
      .filter((f) => f.endsWith('.html'))
      .sort();

let bad = 0;
for (const page of pages) {
  const src = fs.readFileSync(page, 'utf8');
  const blocks = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  if (!blocks.length) {
    console.log(`  ${page.padEnd(18)} no inline script`);
    continue;
  }
  let ok = true;
  blocks.forEach((m, i) => {
    /* the line the block starts on, so an error points at the real file */
    const line = src.slice(0, m.index).split('\n').length;
    try {
      new vm.Script(m[1], { filename: page + ' (block ' + (i + 1) + ', from line ' + line + ')' });
    } catch (err) {
      ok = false;
      bad++;
      console.error(`  ${page}: block ${i + 1} starting at line ${line}\n    ${err.message}`);
    }
  });
  if (ok) console.log(`  ${page.padEnd(18)} ${blocks.length} inline block(s) parse`);
}

/* the standalone scripts the pages load */
for (const f of ['account.js', 'tree-data.js', 'view.js']) {
  if (!fs.existsSync(path.join(process.cwd(), f))) continue;
  try {
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f });
    console.log(`  ${f.padEnd(18)} parses`);
  } catch (err) {
    bad++;
    console.error(`  ${f}: ${err.message}`);
  }
}

/* ---- zoom ----------------------------------------------------------------
   A two-finger trackpad pinch arrives as dozens of tiny ctrl+wheel events.
   Both pages used to apply a fixed 12% per event, so the gentlest pinch
   multiplied the scale by 0.89 twenty-odd times and flung the tree to 0.15,
   where a card title is under three pixels tall. view.js now turns each event
   into a factor proportional to its delta, and stops zooming out once the
   whole tree is already on screen. Checked here without a browser, because
   the arithmetic is the whole of it. */
{
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(fs.readFileSync('view.js', 'utf8'), { filename: 'view.js' }).runInContext(sandbox);
  const V = sandbox.window.TASView;
  const fails = [];
  const expect = (name, cond, got) => {
    if (!cond) fails.push(name + (got === undefined ? '' : ' (got ' + got + ')'));
  };

  /* a gentle pinch: twenty small events must come out gentle, not at the floor */
  let s = 1;
  for (let i = 0; i < 20; i++) s *= V.wheelFactor({ deltaY: 3, deltaMode: 0 });
  expect('a gentle trackpad pinch zooms out gently', s > 0.5 && s < 0.6, s.toFixed(3));

  /* a mouse notch must be exactly the step it always was */
  const notch = V.wheelFactor({ deltaY: 100, deltaMode: 0 });
  expect('a mouse notch is unchanged', Math.abs(notch - 1 / 1.12) < 1e-9, notch);
  const lines = V.wheelFactor({ deltaY: 3, deltaMode: 1 });
  expect('a line-mode notch is unchanged', Math.abs(lines - 1 / 1.12) < 1e-9, lines);

  /* no zoom-out goes past the point where the whole tree fits */
  const rect = { width: 1000, height: 640 };
  const box = { w: 1296, h: 1590 };
  const floor = V.floorFor(rect, box, 26, 0.3, 0.75);
  const view = { s: 1, tx: 0, ty: 0 };
  for (let i = 0; i < 300; i++) V.zoom(view, rect, V.wheelFactor({ deltaY: 3 }), 500, 320, floor);
  expect('a hard pinch stops where the whole tree fits', Math.abs(view.s - floor) < 1e-9, view.s);
  expect('and that is not the old 0.15', view.s > 0.3, view.s);

  /* already below the floor (Fit on a tall tree): zooming in must not jump */
  const low = { s: 0.2, tx: 0, ty: 0 };
  V.zoom(low, rect, 1.05, 500, 320, floor);
  expect('zooming in from below the floor does not jump', Math.abs(low.s - 0.21) < 1e-9, low.s);

  if (fails.length) {
    bad++;
    console.error('  view.js zoom: ' + fails.join('; '));
  } else {
    console.log('  view.js            zoom is proportional and floored');
  }
}

/* ---- CSS sanity ----------------------------------------------------------
   Nothing here validates CSS, and a stylesheet does not fail loudly: an
   unbalanced comment silently swallows the rules after it and the page simply
   renders wrong. This exists because a block was pasted into the middle of
   theme.css's own file comment, where the block's first comment terminator
   closed the outer comment and turned the rest of that prose into
   declarations. Writing this very comment reproduced the bug a second time,
   in JavaScript, which is why no terminator appears in the text of it. */
function cssBlocks(page) {
  const src = fs.readFileSync(page, 'utf8');
  return page.endsWith('.css')
    ? [src]
    : [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
}

for (const file of [...pages, 'theme.css'].filter((f) => fs.existsSync(f))) {
  for (const [i, css] of cssBlocks(file).entries()) {
    const label = file + (cssBlocks(file).length > 1 ? ` (style ${i + 1})` : '');
    /* a nested /* is almost always a block pasted inside another comment */
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const problems = [];
    if (stripped.includes('/*')) problems.push('an unterminated /* comment');
    if (stripped.includes('*/')) problems.push('a stray */ with no opening /*');
    const opens = (stripped.match(/\{/g) || []).length;
    const closes = (stripped.match(/\}/g) || []).length;
    if (opens !== closes) problems.push(`${opens} { against ${closes} }`);
    if (problems.length) {
      bad++;
      console.error(`  ${label}: ${problems.join(', ')}`);
    } else {
      console.log(`  ${label.padEnd(18)} css balanced (${opens} rules)`);
    }
  }
}

/* ---- escaping ------------------------------------------------------------
   A page that interpolates esc() into an HTML attribute needs an esc() that
   escapes quotes. index.html had one that did not, while writing its output
   into value="..." and href="..." — so a reader typing a double quote into
   their own name in the contact form closed the attribute and got a live
   event handler onto the input. There were three copies of esc() and they
   disagreed; there is one definition now, in account.js, and the pages take
   it from there. This is what stops a fourth one appearing. */
for (const page of pages) {
  const src = fs.readFileSync(page, 'utf8');
  const inAttr = [...src.matchAll(/[a-z-]+="'\s*\+\s*esc\(/gi)].length;
  if (!inAttr) continue;

  const strict =
    /window\.TAS\.ui\.esc/.test(src) /* delegates to the one definition */ &&
    /&quot;/.test(src); /* and its fallback escapes quotes too */
  if (strict) {
    console.log(`  ${page.padEnd(18)} esc() is quote-safe (${inAttr} attribute use(s))`);
  } else {
    bad++;
    console.error(
      `  ${page}: esc() output goes into ${inAttr} HTML attribute(s) but esc() does not escape quotes.\n` +
        `    Use the shared one: var esc = (window.TAS && window.TAS.ui && window.TAS.ui.esc) || function(s){...&quot;...}`
    );
  }
}

if (bad) {
  console.error(`\n${bad} problem(s) found.`);
  process.exit(1);
}
console.log('\nAll page scripts parse, and escaping is quote-safe where it reaches attributes.');
