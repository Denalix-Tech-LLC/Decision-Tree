/* ===========================================================================
   HTML FROM ONE ACCOUNT, SHOWN TO EVERYONE
   A published tree is rendered with innerHTML on every reader's page, so the
   strings in it are the one place in this codebase where one account's words
   become other people's markup. This is the filter they pass through, on the
   way in and again on the way out.

   It used to be a handful of regexes that looked for bad things — a script
   tag, an on* attribute after a space, a javascript: at the start of an href
   — and each of those had a way round it: an attribute after a "/" or a
   closing quote instead of a space, a scheme spelled with character
   references or a tab, a forbidden tag reassembled from the pieces left
   when another was cut out of its middle. Looking for bad things means
   knowing every spelling of them.

   So this does the other thing. It reads each tag the way the browser's
   tokenizer does, keeps only tags and attributes on a short list, decodes
   each attribute value before judging it, and writes the tag out again from
   scratch — its name, then each kept attribute as name="value" with the
   value escaped. Nothing of the original tag's spelling survives, so there
   is no spelling left to exploit: the browser reads back exactly what this
   decided to keep. Text between tags passes through as written, except that
   a "<" which could open a tag and did not become a kept one is written as
   &lt; — so a fragment can be concatenated with others, as the reader does,
   without a half-tag at its end swallowing the next one.

   The list is what the shipped content and the print-out use, with some
   room: paragraphs, lists, emphasis, links, tables, and the SVG the
   printed route is drawn in. It does not include ids (an id in content can
   shadow an element the page looks up by id), anything that loads a
   resource from another origin (the page promises readers it makes no such
   request), style beyond typography and spacing (a style attribute can
   otherwise paint a fake sign-in box over the real page), or any class the
   shipped content does not use (a class can borrow the page's own overlay
   rules and do the same). Every fragment comes out with its tags balanced.
   ========================================================================= */

/* Elements removed along with everything inside them. For most of these the
   browser treats the inside as raw text up to the matching end tag, so
   there is nothing in there to keep; for the rest, what is inside is a
   fallback for a thing that is not allowed either. */
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'noscript',
  'noembed',
  'noframes',
  'textarea',
  'title',
  'xmp',
  'plaintext',
  'template',
  'object',
  'embed',
  'applet',
  'select',
]);

const HTML_TAGS = [
  'a', 'abbr', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption',
  'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt',
  'em', 'figcaption', 'figure', 'font', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark', 'ol', 'p', 'pre', 'q',
  's', 'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
];
/* The drawing elements and nothing that fetches, references or animates:
   no use, image, foreignObject, animate or set, and no filter primitives. */
const SVG_TAGS = [
  'svg', 'g', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse',
  'text', 'tspan',
];
const TAGS = new Set([...HTML_TAGS, ...SVG_TAGS]);

/* Attributes allowed on any kept tag. */
const GLOBAL_ATTRS = new Set(['class', 'title', 'lang', 'dir', 'role', 'style']);

/* The class names content may carry. A class is not decoration here: the
   page styles its own chrome by class, and some of those rules are
   position:fixed and full-screen (the sign-in overlay, the sheets, the
   walkthrough). A class="tasa-ovl" in a guide section would borrow all of
   that and paint a convincing "session expired" box over the real page,
   with none of the style filter below ever seeing it. So a class survives
   only if it is on the list for where the markup is going.

     content    what tree-data.js ships uses exactly one: "wnote", the
                shaded read-this-first box in the walkthrough, which the
                editor's hint at /admin tells authors to use.
     document   a saved document is the result panel's print-out (index.html
                printableHtml): its stamp, chips, route drawing and
                disclaimer, plus whatever tree content it quoted.

   Add a name here when shipped content starts using it, not before. */
export const CLASSES = Object.freeze({
  content: new Set(['wnote']),
  document: new Set(['wnote', 'pstamp', 'pc', 'psx', 'pd', 'ptree']),
});

/* Elements with no end tag. Everything else that is opened is closed again
   by the end of the fragment — see cleanHtml. */
const VOID = new Set(['br', 'hr', 'img', 'col', 'wbr']);
/* Attributes allowed only on the tags named. */
const TAG_ATTRS = {
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan', 'headers']),
  th: new Set(['colspan', 'rowspan', 'headers', 'scope']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  ol: new Set(['start', 'reversed', 'type']),
  li: new Set(['value']),
  time: new Set(['datetime']),
  details: new Set(['open']),
  font: new Set(['color', 'face', 'size']),
};
/* Geometry and paint for the SVG tags. None of these is read by an HTML
   element, and each value is still checked for url() below, which is the
   one way a presentation attribute can reach for another resource. */
const SVG_ATTRS = new Set([
  'viewbox', 'preserveaspectratio', 'xmlns', 'width', 'height', 'x', 'y', 'x1', 'y1',
  'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'dx', 'dy', 'rotate',
  'textlength', 'lengthadjust', 'fill', 'fill-opacity', 'fill-rule', 'stroke',
  'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'transform',
  'text-anchor', 'dominant-baseline', 'alignment-baseline', 'font-size', 'font-family',
  'font-weight', 'font-style', 'letter-spacing', 'word-spacing', 'text-decoration',
  'clip-rule', 'vector-effect', 'paint-order', 'shape-rendering', 'visibility',
  'focusable',
]);
const SVG_SET = new Set(SVG_TAGS);
const SVG_NS = 'http://www.w3.org/2000/svg';

/* Typography, spacing and paint. Not position, inset, z-index, transform or
   anything that takes an image: those are how a block of content leaves the
   box it was put in and sits over the page's own controls. */
const STYLE_PROPS = new Set([
  'color', 'background-color', 'font', 'font-size', 'font-weight', 'font-style',
  'font-family', 'font-variant', 'text-align', 'text-decoration', 'text-transform',
  'text-indent', 'line-height', 'letter-spacing', 'word-spacing', 'white-space',
  'vertical-align', 'margin', 'margin-top', 'margin-right', 'margin-bottom',
  'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'border', 'border-top', 'border-right', 'border-bottom',
  'border-left', 'border-color', 'border-style', 'border-width', 'border-radius',
  'border-collapse', 'width', 'max-width', 'min-width', 'height', 'list-style-type',
  'list-style-position', 'opacity', 'display', 'fill', 'stroke', 'stroke-width',
  'stroke-dasharray', 'fill-opacity', 'stroke-opacity', 'text-anchor',
  'dominant-baseline',
]);

/* A small table, not the full two thousand. It does not need to be complete
   to be safe: every value is written back escaped, so a reference this does
   not know reaches the browser as the literal text "&name;" rather than as
   whatever the browser would have decoded it to. What is judged is what is
   shown. The first group is the punctuation a URL scheme can be spelled
   with; the rest keeps ordinary typography in a title or alt intact. */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', colon: ':',
  sol: '/', bsol: '\\', tab: '\t', newline: '\n', lpar: '(', rpar: ')', period: '.',
  comma: ',', excl: '!', num: '#', percnt: '%', equals: '=', semi: ';', quest: '?',
  commat: '@', lowbar: '_', hyphen: '-', plus: '+', ast: '*', dollar: '$', lsqb: '[',
  rsqb: ']', lbrace: '{', rbrace: '}', verbar: '|', grave: '`', Hat: '^',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', middot: '\u00b7', bull: '\u2022', copy: '\u00a9',
  reg: '\u00ae', trade: '\u2122', sect: '\u00a7', para: '\u00b6', deg: '\u00b0',
  times: '\u00d7', divide: '\u00f7', plusmn: '\u00b1', larr: '\u2190', rarr: '\u2192',
  uarr: '\u2191', darr: '\u2193', eacute: '\u00e9', egrave: '\u00e8', aacute: '\u00e1',
  agrave: '\u00e0', oacute: '\u00f3', uacute: '\u00fa', iacute: '\u00ed', ntilde: '\u00f1',
  ccedil: '\u00e7', ouml: '\u00f6', uuml: '\u00fc', auml: '\u00e4', shy: '\u00ad',
};

function decodeEntities(s) {
  return String(s).replace(
    /&(?:#[xX]([0-9a-fA-F]+);?|#([0-9]+);?|([a-zA-Z][a-zA-Z0-9]{0,31});)/g,
    (m, hex, dec, name) => {
      if (name !== undefined) return Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : m;
      const code = hex !== undefined ? parseInt(hex, 16) : parseInt(dec, 10);
      /* what the browser substitutes for a reference to nothing */
      if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd';
      return String.fromCodePoint(code);
    }
  );
}

function escAttr(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* The URL parser drops leading C0 controls and spaces and removes tabs and
   newlines from anywhere before it reads a scheme, so "java\tscript:" is
   javascript:. Judge the value the way it will be read. */
function schemeOf(url) {
  const bare = String(url).replace(/[\u0000-\u0020]+/g, '');
  const m = /^([a-z][a-z0-9+.\-]*):/i.exec(bare);
  return { bare, scheme: m ? m[1].toLowerCase() : null };
}

const LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/* An href: somewhere on this site, or an ordinary web, mail or phone
   address. A link to another origin is a place the reader chooses to go,
   not a request the page makes on their behalf, so it is allowed here and
   nowhere else. */
function safeHref(url) {
  const { scheme } = schemeOf(url);
  return scheme === null || LINK_SCHEMES.has(scheme);
}

/* An image source: this site only, or an inline raster image. Not
   protocol-relative ("//host" or "\\host", which the URL parser reads the
   same way), and not data:image/svg+xml, which is a document. */
function safeSrc(url) {
  const { bare, scheme } = schemeOf(url);
  if (scheme === null) return !/^[\\/]{2}/.test(bare);
  return scheme === 'data' && /^data:image\/(png|jpeg|gif|webp)[;,]/i.test(bare);
}

/* A value that reaches for another resource, in whatever attribute: url(),
   the old IE expression(), or a script URL. */
const REACHES = /url\s*\(|image-set\s*\(|expression\s*\(|javascript:|vbscript:|@import|-moz-binding|behavior\s*:/i;

function cleanStyle(value) {
  const kept = [];
  for (const decl of String(value).split(';')) {
    const i = decl.indexOf(':');
    if (i < 1) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!STYLE_PROPS.has(prop) || !val) continue;
    /* A backslash is a CSS escape — "u\72l(" is url( — and a comment can
       split a keyword, so neither is allowed in a kept value at all. */
    if (/[\\<>{}]|\/\*/.test(val) || REACHES.test(val)) continue;
    /* A negative margin is the other way to pull a block over its
       neighbours. */
    if (prop.startsWith('margin') && val.includes('-')) continue;
    kept.push(prop + ':' + val);
  }
  return kept.join(';');
}

/* One attribute, decoded: the value to write back, or null to drop it. */
function keepAttr(tag, name, raw, classes) {
  if (!/^[a-z][a-z0-9:_.-]*$/i.test(name)) return null;
  const n = name.toLowerCase();
  const value = decodeEntities(raw);
  const allowed =
    GLOBAL_ATTRS.has(n) ||
    (TAG_ATTRS[tag] && TAG_ATTRS[tag].has(n)) ||
    (SVG_SET.has(tag) && SVG_ATTRS.has(n)) ||
    ((n.startsWith('data-') || n.startsWith('aria-')) && n.length > 5 && !n.includes(':'));
  if (!allowed) return null;
  if (n === 'style') {
    const s = cleanStyle(value);
    return s ? s : null;
  }
  if (n === 'class') {
    const kept = value.split(/[\t\n\f\r ]+/).filter((c) => c && classes.has(c));
    return kept.length ? kept.join(' ') : null;
  }
  if (n === 'href') return safeHref(value) ? value : null;
  if (n === 'src') return safeSrc(value) ? value : null;
  if (n === 'xmlns') return value === SVG_NS ? value : null;
  if (n === 'target') return /^_(blank|self)$/i.test(value.trim()) ? value.trim() : null;
  if (n === 'rel') {
    const rel = value
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t === 'noopener' || t === 'noreferrer' || t === 'nofollow' || t === 'external');
    return rel.length ? rel.join(' ') : null;
  }
  if (REACHES.test(value)) return null;
  return value;
}

/* ---- the tokenizer ------------------------------------------------------

   Reads one tag starting at s[at] === '<', following the states the HTML
   tokenizer goes through, so that where this thinks an attribute starts and
   ends is where the browser thinks it does. In particular an attribute can
   follow a quoted value or a "/" with no space between — that is the gap
   the old filter left open. Returns null if the input ends inside the tag,
   which the browser treats as no tag at all. */
const WS = /[\t\n\f\r ]/;

function readTag(s, at) {
  let i = at + 1;
  let end = false;
  if (s[i] === '/') {
    end = true;
    i++;
  }
  if (!/[a-zA-Z]/.test(s[i] || '')) return undefined; /* not a tag at all */
  const nameStart = i;
  while (i < s.length && !WS.test(s[i]) && s[i] !== '/' && s[i] !== '>') i++;
  const name = s.slice(nameStart, i).toLowerCase();
  const attrs = [];
  let selfClosing = false;
  for (;;) {
    /* before an attribute name */
    while (i < s.length && (WS.test(s[i]) || s[i] === '/')) {
      if (s[i] === '/' && s[i + 1] === '>') {
        selfClosing = true;
        i++;
        break;
      }
      i++;
    }
    if (i >= s.length) return null;
    if (s[i] === '>') return { name, end, attrs, selfClosing, next: i + 1 };
    /* the name: a leading "=" belongs to it, as it does for the browser */
    const aStart = i;
    i++;
    while (i < s.length && !WS.test(s[i]) && s[i] !== '/' && s[i] !== '>' && s[i] !== '=') i++;
    const aName = s.slice(aStart, i);
    while (i < s.length && WS.test(s[i])) i++;
    if (i >= s.length) return null;
    if (s[i] !== '=') {
      attrs.push([aName, '', true]);
      continue;
    }
    i++;
    while (i < s.length && WS.test(s[i])) i++;
    if (i >= s.length) return null;
    const q = s[i];
    if (q === '"' || q === "'") {
      const close = s.indexOf(q, i + 1);
      if (close < 0) return null;
      attrs.push([aName, s.slice(i + 1, close)]);
      i = close + 1;
    } else if (q === '>') {
      attrs.push([aName, '']);
    } else {
      const vStart = i;
      while (i < s.length && !WS.test(s[i]) && s[i] !== '>') i++;
      attrs.push([aName, s.slice(vStart, i)]);
    }
  }
}

function writeTag(t, classes) {
  if (t.end) return '</' + t.name + '>';
  const seen = new Set();
  let out = '<' + t.name;
  for (const [name, raw, bare] of t.attrs) {
    const key = name.toLowerCase();
    /* the browser keeps the first of two same-named attributes */
    if (seen.has(key)) continue;
    seen.add(key);
    const v = keepAttr(t.name, name, raw, classes);
    if (v === null) continue;
    /* A flag written as a flag stays one, so shipped content such as
       <a data-open-contact> comes back exactly as it went in. */
    out += bare && v === '' ? ' ' + name : ' ' + name + '="' + escAttr(v) + '"';
  }
  /* SVG needs its self-closing slash — without it each <line> would open a
     child the next <rect> is drawn inside, and never shown. */
  return out + (t.selfClosing && SVG_SET.has(t.name) ? '/>' : '>');
}

/* The text after an unterminated tag: shown, never parsed. */
function inert(text) {
  return text.replace(/<(?=[a-zA-Z\/!?])/g, '&lt;');
}

/* Each fragment comes out balanced: every element it opens is closed by its
   end, and an end tag for something it did not open is dropped. The reader
   joins fragments before handing them to innerHTML, so without this a guide
   section ending in an open <a href="…"> would make the next section, and
   the page's own words after it, part of that link — and a stray </div>
   would close the box the page put the content in, letting what follows sit
   outside it. On its own innerHTML cannot reach outside the element it is
   assigned to; balanced, a joined string cannot either.

   options.classes is the class allowlist for where the markup is going
   (CLASSES above); tree content is the default because it is the markup
   shown to everyone. */
export function cleanHtml(html, { classes = CLASSES.content } = {}) {
  const s = String(html == null ? '' : html).replace(/\u0000/g, '');
  if (s.indexOf('<') < 0) return s; /* the common case: prose, an id, a label */
  const open = [];
  const out = balanced(s, classes, open);
  let tail = '';
  for (let k = open.length - 1; k >= 0; k--) tail += '</' + open[k] + '>';
  return out + tail;
}

function balanced(s, classes, open) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, lt);
    /* Comments go, with what is in them. */
    if (s.startsWith('<!--', lt)) {
      const close = s.indexOf('-->', lt + 4);
      if (close < 0) break;
      i = close + 3;
      continue;
    }
    const t = readTag(s, lt);
    if (t === undefined) {
      /* "<" then something that cannot start a tag name: to the browser
         that is either plain text ("a < b") or the start of a comment-like
         construct ("<!", "<?", "</ "), and the second is shown as text */
      out += /[\/!?]/.test(s[lt + 1] || '') ? '&lt;' : '<';
      i = lt + 1;
      continue;
    }
    if (t === null) {
      /* The input ends inside a tag. On its own the browser would drop it,
         but the reader joins strings together, and the next one's ">"
         would finish it. Everything from here on is kept as text. */
      out += inert(s.slice(lt));
      break;
    }
    i = t.next;
    if (!t.end && DROP_WITH_CONTENT.has(t.name)) {
      /* skip to the end of the element; with no end, to the end of the
         string, which is where the browser would have run it to */
      /* A regex rather than indexOf on a lowercased copy: lowercasing can
         change the length of the string (some capitals lowercase to two
         code units), and then the positions no longer line up. The name is
         one of the fixed words above, so it is safe inside a pattern. */
      const endRe = new RegExp('</' + t.name, 'gi');
      endRe.lastIndex = i;
      const found = endRe.exec(s);
      if (!found) break;
      const close = found.index;
      const after = s.indexOf('>', close);
      if (after < 0) break;
      i = after + 1;
      continue;
    }
    if (!TAGS.has(t.name)) continue;
    if (t.end) {
      /* Close back to the matching element, closing whatever was left open
         inside it on the way (<b><i>x</b> becomes <b><i>x</i></b>). With no
         matching element open, the end tag is not this fragment's to write. */
      const at = open.lastIndexOf(t.name);
      if (at < 0) continue;
      while (open.length > at) out += '</' + open.pop() + '>';
      continue;
    }
    out += writeTag(t, classes);
    /* A void element never opens anything, and an SVG shape written with
       its slash (<line/>) is complete as it stands. An HTML element written
       <div/> is open all the same — the browser ignores that slash — and
       writeTag drops it, so it is counted as open here too. */
    if (!VOID.has(t.name) && !(t.selfClosing && SVG_SET.has(t.name))) open.push(t.name);
  }
  return out;
}

/* A URL that the reader will put between the quotes of an href by string
   concatenation (tree-data.js LINKS). It must be a link this filter would
   have kept, and it must not be able to leave the quotes it is put in, so
   the characters that could close them or open a tag are percent-encoded —
   which is what the browser would send for them anyway. */
export function cleanUrl(url) {
  const v = String(url == null ? '' : url).trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (!v || !safeHref(v)) return '#';
  return v.replace(/[\s"'<>`]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}
