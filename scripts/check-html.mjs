/* Parse-check the inline scripts in every HTML page.

     node scripts/check-html.mjs

   The pages carry their JavaScript inline, so a syntax error in one of them
   is invisible to `node --check` and shows up as a blank page instead. This
   pulls each <script> block out and parses it the way the browser would.

   It also checks the two things about a page that only production sees: that
   vercel.json's Content-Security-Policy still carries the hash of every
   inline block (scripts/csp.mjs, npm run csp), and that .vercelignore uploads
   everything the pages load and nothing that .gitignore keeps private.
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { cspProblems, readIgnore, isIgnored, deployable } from './csp.mjs';

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
for (const f of ['account.js', 'tree-data.js', 'look.js', 'view.js']) {
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

/* ---- Content-Security-Policy ---------------------------------------------
   vercel.json allows each page's inline scripts by their SHA-256, so editing
   one character of an inline script without regenerating the hashes gives a
   page that parses, passes everything above, works on any server that does
   not send the header — and is blank in production. This is the check that
   makes that impossible to miss. The fix is always `npm run csp`. */
{
  const problems = cspProblems();
  if (problems.length) {
    bad++;
    console.error(
      '  vercel.json: the Content-Security-Policy is stale, and production would refuse\n' +
        '    the pages’ own scripts:\n' +
        problems.map((p) => '      ' + p).join('\n') +
        '\n    Run: npm run csp'
    );
  } else {
    console.log('  vercel.json        Content-Security-Policy hashes match every page');
  }
}

/* ---- what a deployment uploads -------------------------------------------
   Everything uploaded that is not a function is served, publicly. The CLI
   reads .vercelignore and not .gitignore, which is how .pglite/ — the local
   database, account emails and password hashes — came to be served by a
   manual deploy. Two checks, one in each direction:
     - nothing .gitignore keeps out of the repository may be uploaded, since
       whatever is too private to commit is too private to publish;
     - everything a page loads must be uploaded, or it 404s in production. */
{
  const root = process.cwd();
  const vercel = readIgnore(root, '.vercelignore');
  const git = readIgnore(root, '.gitignore');
  const leaks = [];
  const uploaded = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? dir + '/' + e.name : e.name;
      if (e.name === '.git') continue;
      const isDir = e.isDirectory();
      if (!deployable(vercel, rel, isDir)) continue; /* not uploaded: fine */
      if (isIgnored(git, rel, isDir)) leaks.push(rel + (isDir ? '/' : ''));
      else if (isDir) walk(rel);
      else uploaded.push(rel);
    }
  };
  walk('');

  const missing = [];
  const refs = new Set(['api/[...route].js', 'api/index.js', 'package.json', 'package-lock.json', 'vercel.json']);
  for (const page of pages) {
    const src = fs.readFileSync(page, 'utf8');
    for (const m of src.matchAll(/\b(?:src|href)="([\w./-]+\.(?:js|css|jpe?g|png|webp|svg|ico))"/g)) refs.add(m[1]);
  }
  for (const f of [...pages, 'theme.css'].filter((f) => fs.existsSync(f))) {
    for (const css of cssBlocks(f)) {
      for (const m of css.matchAll(/url\(\s*["']?([\w./-]+\.(?:jpe?g|png|webp|svg|woff2?))["']?\s*\)/g)) refs.add(m[1]);
    }
  }
  for (const page of pages) refs.add(page);
  for (const r of refs) {
    const rel = r.replace(/^\.?\//, '');
    if (!fs.existsSync(path.join(root, rel))) missing.push(rel + ' (referenced, but not on disk)');
    else if (!deployable(vercel, rel, false)) missing.push(rel + ' (excluded by .vercelignore)');
  }

  if (leaks.length) {
    bad++;
    console.error(
      '  .vercelignore: a deployment would upload, and serve publicly, what .gitignore keeps private:\n' +
        leaks.map((l) => '      ' + l).join('\n')
    );
  }
  if (missing.length) {
    bad++;
    console.error(
      '  .vercelignore: the site needs files a deployment would leave out:\n' +
        missing.map((l) => '      ' + l).join('\n')
    );
  }
  if (!leaks.length && !missing.length) {
    console.log(`  .vercelignore      uploads all ${refs.size} files the pages load, and nothing gitignored`);
  }

  /* ---- what a Git deployment would leave out ------------------------------
     Both the GitHub Actions workflow and the dashboard's Git integration build
     from a checkout, so a file that is on disk but not in git is uploaded by a
     manual `npx vercel --prod` and missing from every Git deploy. That is how
     a partial commit ships a function that fails at import (records.js needs
     markup.js; the dispatcher needs the media routes) and a reader whose
     look.js is a 404. A warning, not a failure: a working copy is allowed to
     have new files it has not committed yet — but the next commit must
     `git add` them. Staged files count as tracked. Skipped outside a
     repository or without git. */
  let tracked = null;
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
    });
    tracked = new Set(out.split('\0').filter(Boolean));
  } catch {
    /* not a git checkout, or git is not installed */
  }
  if (tracked) {
    const untracked = uploaded.filter((f) => !tracked.has(f)).sort();
    /* and the tooling: every file an npm script runs, plus the module this
       check imports, so a commit cannot leave npm run check or selftest
       pointing at a file only this machine has */
    const tooling = new Set(['scripts/csp.mjs']);
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      for (const cmd of Object.values(pkg.scripts || {})) {
        for (const m of String(cmd).matchAll(/\bnode\s+([\w./-]+\.m?js)\b/g)) tooling.add(m[1]);
      }
    } catch {
      /* an unreadable package.json fails loudly elsewhere */
    }
    for (const t of [...tooling].sort()) {
      if (fs.existsSync(path.join(root, t)) && !tracked.has(t) && !untracked.includes(t)) untracked.push(t);
    }
    if (untracked.length) {
      const quote = (u) => (/[\s[\]]/.test(u) ? '"' + u + '"' : u);
      console.warn(
        '  WARNING git:       ' + untracked.length + ' file(s) the site or its npm scripts need are not tracked.\n' +
          '    A Git-based deploy (the workflow, or the dashboard) or a fresh clone would lack them:\n' +
          untracked.map((u) => '      ' + u).join('\n') +
          '\n    Before committing: git add ' + untracked.map(quote).join(' ')
      );
    } else {
      console.log(`  git                tracks all ${uploaded.length} files a deployment uploads`);
    }
  }
}

if (bad) {
  console.error(`\n${bad} problem(s) found.`);
  process.exit(1);
}
console.log(
  '\nAll page scripts parse, escaping is quote-safe where it reaches attributes,\n' +
    'the Content-Security-Policy matches, and a deployment uploads what it should.'
);
