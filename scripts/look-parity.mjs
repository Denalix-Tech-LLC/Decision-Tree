/* ===========================================================================
   LOOK.JS AGAINST MARKUP.JS
   look.js carries a browser copy of the server's markup filter, because the
   /admin draft (which Import fills with whatever JSON was pasted) reaches the
   reader's innerHTML without going near the server. Two copies of one filter
   drift: the server gained a class allowlist, tag balancing and a plain-text
   CONTACT while the browser copy kept none of them. This holds them together.

   It loads look.js the way a page does (in a vm, no DOM needed for these
   functions) and asserts, over a fixed corpus plus a seeded random one:

     - cleanHtml gives byte-identical output to api/_lib/markup.js, for both
       class lists (tree content and saved documents)
     - cleanUrl gives identical output
     - cleanContact gives what records.js cleanTreeData makes of CONTACT
     - the shipped tree (tree-data.js) comes through cleanTree unchanged,
       and through the server's cleanTreeData unchanged

   No network and no database. Exits non-zero on any difference.
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markup = await import(pathToFileURL(path.join(root, 'api/_lib/markup.js')).href);

function load(file, extra = {}) {
  const sandbox = { module: { exports: {} }, console, ...extra };
  vm.createContext(sandbox);
  new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file }).runInContext(sandbox);
  return sandbox.module.exports;
}
const LOOK = load('look.js');
const TREE = load('tree-data.js');

let records = null;
try {
  records = await import(pathToFileURL(path.join(root, 'api/_lib/records.js')).href);
} catch (err) {
  console.log('  look-parity        (records.js did not load here: ' + err.message + '; CONTACT compared by rule only)');
}

const fails = [];
function same(what, input, a, b) {
  if (a !== b && fails.length < 12) {
    fails.push(`${what}\n      input:   ${JSON.stringify(input).slice(0, 300)}\n      server:  ${JSON.stringify(a).slice(0, 300)}\n      browser: ${JSON.stringify(b).slice(0, 300)}`);
  } else if (a !== b) fails.push(what);
}

/* ---- the corpus ---------------------------------------------------------- */
const fixed = [
  '',
  'plain prose, no markup',
  'a < b and c > d',
  '<b>bold <i>both</b> after',
  '<div><p>unclosed',
  '</div>stray end<p>x</p></section>',
  '<div class="wnote tasa-ovl ovl">x</div>',
  '<div class="pstamp wnote">doc class</div>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="java&#x09;script:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="https://example.com/" target="_blank" rel="noopener evil">x</a>',
  '<a href="mailto:a@b.c">m</a><a href="tel:+1">t</a><a href="data:text/html,x">d</a>',
  '<img src="data:image/png;base64,AAAA" onerror="alert(1)">',
  '<img src="data:image/svg+xml,<svg onload=alert(1)>">',
  '<img src="//evil.example/x.png"><img src="\\\\evil/x.png"><img src="/ok.png">',
  '<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="1" y2="1"/><rect width="1" height="1"/><text>t</text></svg>',
  '<svg><use href="#x"/><foreignObject><div>x</div></foreignObject></svg>',
  '<script>alert(1)</script>after',
  '<SCRIPT>alert(1)</SCRIPT >after',
  '<style>body{}</style><iframe srcdoc="<script>x</script>"></iframe><object data=x></object><embed src=x>',
  '<link rel=stylesheet href=x><meta http-equiv=refresh content="0;url=x"><base href=x><form action=x><input></form>',
  '<p onclick="x" style="color:red;position:fixed;background:url(x)">s</p>',
  '<p style="margin:-10px;padding:1px;color:\\72 ed">s</p>',
  '<p/onclick=alert(1)>x</p>',
  '<p title="a"onclick="b">x</p>',
  '<a href=x id=y data-open-contact aria-label="z">a</a>',
  '<div/>open anyway',
  '<br/><hr><wbr><col>',
  '<!-- comment <script>x</script> -->kept',
  '<!-- unterminated',
  '<p title="unterminated',
  '<p>text</p><a',
  '<b>&amp; &lt; &#0; &#x110000; &unknown; &colon;</b>',
  '<font color="red" face="x" size="2">f</font>',
  '<table><tr><td colspan=2>x</td></tr></table>',
  '<details open><summary>s</summary>d</details>',
  '<scr<script>x</script>ipt>alert(1)</script>',
  '<textarea><b>x</b></textarea>y',
  '<select><option>x</select>y',
  '<p lang=en dir=rtl role=note class="  wnote  ">x</p>',
  '<p class=wnote\tclass=other>x</p>',
  '\u0000<b>nul</b>',
];

/* seeded, so a failure reproduces */
let seed = 0x2f6e2b1;
function rnd(n) {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed % n;
}
const bits = [
  '<', '>', '/', '</', '="', "='", '"', "'", ' ', '\t', '\n', '=', '&', '&#', ';', '<!--', '-->',
  'a', 'b', 'p', 'div', 'span', 'img', 'svg', 'line', 'script', 'style', 'iframe', 'textarea',
  'class', 'wnote', 'ovl', 'tasa-ovl', 'pstamp', 'href', 'src', 'style', 'onclick', 'onerror',
  'javascript:', 'https://x.y/', 'data:image/png,', 'url(', 'color:red', 'position:fixed',
  'x', 'text', '#x6a;', '#106', 'amp;', 'colon;', '/>', 'br', 'hr', 'title', 'details', 'a',
];
const random = [];
for (let n = 0; n < 6000; n++) {
  let s = '';
  const len = 1 + rnd(24);
  for (let k = 0; k < len; k++) s += bits[rnd(bits.length)];
  random.push(s);
}

/* every string the shipped tree carries, which is the content that matters */
const shippedStrings = [];
(function walk(v) {
  if (typeof v === 'string') shippedStrings.push(v);
  else if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === 'object') Object.values(v).forEach(walk);
})(TREE);

const corpus = [...fixed, ...shippedStrings, ...random];

/* ---- cleanHtml and cleanUrl ---------------------------------------------- */
for (const s of corpus) {
  same('cleanHtml (content)', s, markup.cleanHtml(s), LOOK.cleanHtml(s));
  same('cleanHtml (document)', s,
    markup.cleanHtml(s, { classes: markup.CLASSES.document }),
    LOOK.cleanHtml(s, { classes: 'document' }));
  same('cleanUrl', s, markup.cleanUrl(s), LOOK.cleanUrl(s));
}
for (const u of [' https://x.y/a b"c ', 'JaVaScRiPt:x', '\tjavascript:x', 'mailto:a@b', '/rel', '#frag', null, undefined, 42]) {
  same('cleanUrl', u, markup.cleanUrl(u), LOOK.cleanUrl(u));
}

/* ---- CONTACT ------------------------------------------------------------- */
const contacts = [
  { name: '<b>Ann</b> "O\'Neil"', role: 'Air <i>quality</i>', email: 'a@b.c<script>', phone: '555\u0001-1234', calendly: 'https://calendly.com/x' },
  { calendly: 'javascript:alert(1)' },
  { calendly: 'http://calendly.com/x' },
  { calendly: 'https://evil.example/"><script>' },
  { calendly: ' https://sub.calendly.com/a b ' },
  { name: 5, extra: '<img src=x onerror=alert(1)>' },
  'not an object',
  null,
];
for (const c of contacts) {
  const b = JSON.stringify(LOOK.cleanContact(c));
  if (records) {
    let a;
    try {
      a = JSON.stringify(records.cleanTreeData({ NODES: { q: { a: [{ to: 'x' }] } }, CONTACT: c }).CONTACT);
    } catch (err) {
      a = 'threw: ' + err.message;
    }
    same('cleanContact', c, a, b);
  }
  const o = LOOK.cleanContact(c);
  for (const k of ['name', 'role', 'email', 'phone']) {
    if (/[<>]/.test(o[k])) fails.push(`cleanContact left markup in ${k}: ${JSON.stringify(o[k])}`);
  }
  if (o.calendly && !/^https:\/\//.test(o.calendly)) fails.push('cleanContact kept a non-https calendly');
}

/* ---- whole trees --------------------------------------------------------- */
const shipped = JSON.stringify(TREE);
const viaLook = JSON.stringify(LOOK.cleanTree(JSON.parse(shipped)));
if (viaLook !== shipped) fails.push('tree-data.js does not come through look.js cleanTree unchanged');
if (records) {
  const viaServer = JSON.stringify(records.cleanTreeData(JSON.parse(shipped)));
  if (viaServer !== shipped) fails.push('tree-data.js does not come through records.js cleanTreeData unchanged');
}
/* a hostile draft, the way Import would store it */
const hostile = LOOK.cleanTree({
  NODES: { q: { t: '<img src=x onerror=alert(1)>', a: [{ l: '<a href="javascript:x">y</a>', to: 'z' }] } },
  GUIDE: [{ h: '<script>x</script>h', html: '<div class="tasa-ovl"><iframe src=x></iframe></div>' }],
  LINKS: [{ t: 'x', u: 'javascript:alert(1)' }, { t: 'y', u: 'https://ok.example/"onmouseover="x' }],
  CONTACT: { calendly: 'javascript:alert(1)', name: '<b>x</b>' },
  __proto__: { polluted: true },
});
const hs = JSON.stringify(hostile);
for (const bad of ['onerror', 'javascript:', '<script', '<iframe', 'tasa-ovl', '"onmouseover', '<b>']) {
  if (hs.includes(bad)) fails.push(`a hostile draft kept ${bad}: ${hs.slice(0, 300)}`);
}

if (fails.length) {
  console.error(`  look-parity        ${fails.length} difference(s) between look.js and the server:`);
  for (const f of fails.slice(0, 12)) console.error('    ' + f);
  process.exit(1);
}
console.log(`  look-parity        look.js matches markup.js over ${corpus.length} inputs; shipped tree unchanged`);
