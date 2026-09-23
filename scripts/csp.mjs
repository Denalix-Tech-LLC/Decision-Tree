/* ===========================================================================
   WHAT PRODUCTION SERVES: ITS HEADERS AND ITS FILES

     npm run csp            rewrite the Content-Security-Policy rules in vercel.json
     npm run csp -- --check exit 1 if they no longer match the pages

   CONTENT-SECURITY-POLICY. Every page carries its application inline, in one
   or two big <script> blocks, and there is no build step to move them into
   files. So the policy allows those exact blocks by their SHA-256 and nothing
   else inline: an injected <script>, an onerror= attribute or a javascript:
   URL in something a reader or the editor saved has no hash and does not run.

   The cost is that a hash is of the exact text. Change one character of an
   inline script and the old hash no longer matches — and the browser does not
   fail loudly, it just refuses the block, which is a blank tree in production
   on a page that worked perfectly on the laptop that edited it. Two things
   stop that from being silent:

     - scripts/check-html.mjs (npm run check) fails when vercel.json's hashes
       are not the pages' hashes, and says to run npm run csp;
     - dev-server.mjs sends the same headers, read from vercel.json, so a stale
       hash blanks the page locally too, before anyone deploys it.

   One rule per page URL. cleanUrls is on, so /admin serves admin.html, and
   /index and the .html spellings are covered too because they reach the same
   file. Everything else — the scripts, the stylesheet, /api — gets a fallback
   that allows no script at all, and /api/media/* is left alone because that
   handler sends its own sandboxed policy for the images it serves.

   The rules are generated so they never overlap: each path gets exactly one
   Content-Security-Policy, rather than depending on which of two matching
   rules the platform lets win.

   THE FILES. .vercelignore decides what a deployment uploads, and anything
   uploaded that is not a function is served, publicly, as a static file. The
   parser below is the one the dev server uses to refuse the same things
   production never has, and check-html uses to check .vercelignore itself.
   ========================================================================= */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Each page and the URLs that serve it. Only the reader embeds anything: the
   Calendly booking frame in the Contact panel. The Calendly link is set by the
   editor and a scheduling service other than Calendly is documented to work
   only as a link, which is exactly what frame-src enforces. */
export const PAGES = [
  {
    file: 'index.html',
    sources: ['/', '/index', '/index.html'],
    frames: ['https://calendly.com', 'https://*.calendly.com'],
  },
  { file: 'admin.html', sources: ['/admin', '/admin.html'], frames: [] },
  { file: 'work.html', sources: ['/work', '/work.html'], frames: [] },
];

const CSP = 'Content-Security-Policy';

/* The inline blocks, as the browser will hash them. The HTML parser turns
   CRLF and lone CR into LF before a script ever sees its text, so the hash is
   taken after doing the same — otherwise a Windows checkout with autocrlf
   would compute hashes no browser produces. A <script src> has no inline
   text to hash; its source is covered by 'self'. */
export function inlineScripts(html) {
  return [...String(html).matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(
    (m) => m[1].replace(/\r\n?/g, '\n')
  );
}

export function hashOf(text) {
  return "'sha256-" + crypto.createHash('sha256').update(text, 'utf8').digest('base64') + "'";
}

/* 'unsafe-inline' for styles is deliberate and is not the hole it is for
   scripts: the pages set style="" attributes and element.style everywhere,
   and CSS cannot run code. img-src takes data: for the small inline images
   the stylesheets use; the photograph is same-origin (land.jpg or
   /api/media/<hash>, enforced by look.js). The Google sign-in is a top-level
   navigation to /api/auth/google/start, which CSP does not govern, so
   accounts.google.com appears nowhere here. */
export function pagePolicy(hashes, frames) {
  return [
    "default-src 'self'",
    ["script-src 'self'"].concat(hashes).join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    'frame-src ' + (frames && frames.length ? frames.join(' ') : "'none'"),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/* For every response that is not a page: JSON, scripts, the stylesheet, the
   OAuth error page (which has an inline <style> and no script). Nothing
   served here should ever execute anything as a document. */
export const FALLBACK_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/* Everything except the page URLs and /api/media/*. ".+" rather than ".*"
   leaves out "/" itself, which is the reader. */
export function fallbackSource() {
  const pages = PAGES.flatMap((p) => p.sources)
    .filter((s) => s !== '/')
    .map((s) => escapeRe(s.slice(1)) + '$');
  return '/((?!' + ['api/media/'].concat(pages).join('|') + ').+)';
}

/* The CSP rules vercel.json should carry, computed from the pages on disk. */
export function cspRules(root = ROOT) {
  const rules = [];
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(root, page.file), 'utf8');
    const value = pagePolicy(inlineScripts(html).map(hashOf), page.frames);
    for (const source of page.sources) {
      rules.push({ source, headers: [{ key: CSP, value }] });
    }
  }
  rules.push({ source: fallbackSource(), headers: [{ key: CSP, value: FALLBACK_POLICY }] });
  return rules;
}

const isCspRule = (rule) =>
  (rule.headers || []).some((h) => String(h.key).toLowerCase() === CSP.toLowerCase());

/* vercel.json with its CSP rules replaced by `rules`, placed straight after
   the first rule (the site-wide one) so the file reads top to bottom:
   everything, then the pages, then caching. Every other rule is untouched. */
export function withCsp(config, rules) {
  const others = (config.headers || []).filter((r) => !isCspRule(r));
  const at = others.length ? 1 : 0;
  return { ...config, headers: others.slice(0, at).concat(rules, others.slice(at)) };
}

/* What is wrong with vercel.json's CSP, as sentences; empty when current. */
export function cspProblems(root = ROOT) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const have = (config.headers || []).filter(isCspRule);
  const want = cspRules(root);
  const problems = [];
  for (const rule of want) {
    const got = have.find((r) => r.source === rule.source);
    if (!got) problems.push('no Content-Security-Policy rule for ' + rule.source);
    else if (JSON.stringify(got.headers) !== JSON.stringify(rule.headers)) {
      problems.push('the policy for ' + rule.source + ' does not match the page (a script hash changed?)');
    }
  }
  for (const r of have) {
    if (!want.some((w) => w.source === r.source)) {
      problems.push('a Content-Security-Policy rule for ' + r.source + ' that no page needs');
    }
  }
  /* a page nobody listed would get the fallback, which runs no script at all */
  for (const f of fs.readdirSync(root).filter((f) => f.endsWith('.html'))) {
    if (!PAGES.some((p) => p.file === f)) problems.push(f + ' is a page with no entry in PAGES in scripts/csp.mjs');
  }
  return problems;
}

/* ---- matching vercel.json the way the platform does -----------------------
   Vercel compiles each `source` with path-to-regexp (strict, case-sensitive):
   a parenthesised group is a regular expression, and everything else is
   literal. That subset is all vercel.json uses, so that is all this does —
   enough for the dev server to send the same headers for the same paths. */
export function sourceToRegex(source) {
  let re = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '(') {
      let depth = 1;
      let j = i + 1;
      let pattern = '';
      if (source[j] === '?') throw new Error('a group cannot start with "?" in ' + source);
      while (j < source.length) {
        if (source[j] === '\\') {
          pattern += source[j] + source[j + 1];
          j += 2;
          continue;
        }
        if (source[j] === ')' && --depth === 0) break;
        if (source[j] === '(') depth++;
        pattern += source[j++];
      }
      if (depth) throw new Error('unbalanced ( in ' + source);
      re += '(' + pattern + ')';
      i = j;
      const mod = source[i + 1];
      if (mod === '?' || mod === '*' || mod === '+') re += source[++i];
    } else if (c === ':') {
      const name = /^:\w+/.exec(source.slice(i))[0];
      re += '([^/]+?)';
      i += name.length - 1;
    } else {
      re += escapeRe(c);
    }
  }
  return new RegExp('^' + re + '$');
}

/* The headers vercel.json gives a path, in rule order, a later rule winning
   a key an earlier one also set. */
export function headersFor(config, pathname) {
  const out = new Map();
  for (const rule of config.headers || []) {
    if (!sourceToRegex(rule.source).test(pathname)) continue;
    for (const h of rule.headers || []) out.set(h.key.toLowerCase(), [h.key, h.value]);
  }
  return [...out.values()];
}

/* ---- .vercelignore ---------------------------------------------------------
   gitignore syntax, which is what the Vercel CLI reads it as (via the
   `ignore` package): later lines win, "!" re-includes, a leading or inner "/"
   anchors a pattern to the root, a trailing "/" means directories only, and
   nothing inside an ignored directory can be re-included. */
function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end < 0) re += '\\[';
      else {
        re += '[' + glob.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\') + ']';
        i = end;
      }
    } else re += escapeRe(c);
  }
  return new RegExp('^' + re + '$');
}

export function parseIgnore(text) {
  const rules = [];
  for (let line of String(text).split(/\r?\n/)) {
    line = line.replace(/(?<!\\)\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    let neg = false;
    if (line.startsWith('!')) {
      neg = true;
      line = line.slice(1);
    } else if (line.startsWith('\\')) line = line.slice(1);
    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    if (line) rules.push({ neg, dirOnly, anchored, re: globToRe(line) });
  }
  return rules;
}

/* `rel` is a root-relative path with forward slashes. */
export function isIgnored(rules, rel, isDir) {
  const parts = rel.split('/').filter(Boolean);
  for (let i = 1; i <= parts.length; i++) {
    const sub = parts.slice(0, i).join('/');
    const dir = i < parts.length || !!isDir;
    let ignored = false;
    for (const r of rules) {
      if (r.dirOnly && !dir) continue;
      if (r.re.test(r.anchored ? sub : parts[i - 1])) ignored = !r.neg;
    }
    if (ignored) return true;
  }
  return false;
}

export function readIgnore(root = ROOT, name = '.vercelignore') {
  try {
    return parseIgnore(fs.readFileSync(path.join(root, name), 'utf8'));
  } catch {
    return [];
  }
}

/* Would a deployment serve this path? Dot-anything and node_modules never,
   whatever .vercelignore says — the CLI has its own built-in list of those,
   and a dev server has no business being more generous than production. */
export function deployable(rules, rel, isDir) {
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length) return true;
  if (parts.some((p) => p.startsWith('.') || p === 'node_modules')) return false;
  return !isIgnored(rules, parts.join('/'), isDir);
}

/* ---- the command ---------------------------------------------------------- */
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const file = path.join(ROOT, 'vercel.json');
  if (process.argv.includes('--check')) {
    const problems = cspProblems();
    if (problems.length) {
      console.error(problems.map((p) => '  ' + p).join('\n') + '\n\nRun: npm run csp');
      process.exit(1);
    }
    console.log('  vercel.json        Content-Security-Policy matches every page');
  } else {
    const before = fs.readFileSync(file, 'utf8');
    const after = JSON.stringify(withCsp(JSON.parse(before), cspRules()), null, 2) + '\n';
    if (after === before.replace(/\r\n/g, '\n')) {
      console.log('vercel.json is already current.');
    } else {
      fs.writeFileSync(file, after);
      for (const p of PAGES) {
        const n = inlineScripts(fs.readFileSync(path.join(ROOT, p.file), 'utf8')).length;
        console.log('  ' + p.file.padEnd(12) + n + ' inline block(s) hashed');
      }
      console.log('vercel.json updated. Commit it together with the page change.');
    }
  }
}
