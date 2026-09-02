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

if (bad) {
  console.error(`\n${bad} block(s) failed to parse.`);
  process.exit(1);
}
console.log('\nAll page scripts parse.');
