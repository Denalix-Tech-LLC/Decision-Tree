/* A five-line .env reader, so `npm run db:init` works from a checkout without
   adding dotenv to the dependency list. Vercel injects real environment
   variables, so this only ever matters locally, and an already-set variable
   always wins over the file. */
import fs from 'node:fs';
import path from 'node:path';

export function loadEnv(file = '.env') {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return false;
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  return true;
}
