// Elenca le frasi da tradurre: gli argomenti letterali di t('…'), tn(n, '…', '…') e tk('…')
// nei file dell'interfaccia. Uso: node scripts/i18n-keys.mjs [--missing en|fr]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STR = String.raw`'((?:[^'\\]|\\.)*)'`;
const CALLS = [
  new RegExp(String.raw`(?<![\w.])t\(\s*${STR}`, 'g'),
  new RegExp(String.raw`(?<![\w.])tk\(\s*${STR}`, 'g'),
  new RegExp(String.raw`(?<![\w.])tip\(\s*${STR}`, 'g'),
  new RegExp(String.raw`(?<![\w.])tn\(\s*[^,]+?,\s*${STR}\s*,\s*${STR}`, 'g'),
];

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'i18n' ? [] : files(p);
    return /\.(ts|svelte)$/.test(n) ? [p] : [];
  });
}

const unescape = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n');

export function collectKeys(root = 'src') {
  const keys = new Map();
  for (const f of files(root)) {
    const src = readFileSync(f, 'utf8');
    for (const re of CALLS) {
      for (const m of src.matchAll(re)) {
        for (const g of m.slice(1)) if (g !== undefined) keys.set(unescape(g), f);
      }
    }
  }
  return keys;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const keys = collectKeys();
  const i = process.argv.indexOf('--missing');
  if (i > 0) {
    const lang = process.argv[i + 1];
    // Le chiavi del dizionario, lette dal sorgente (una per riga: "chiave": "traduzione",).
    const src = readFileSync(`src/lib/i18n/${lang}.ts`, 'utf8');
    const dict = new Set([...src.matchAll(/^\s*("(?:[^"\\]|\\.)*"):/gm)].map((m) => JSON.parse(m[1])));
    for (const [k, f] of keys) if (!dict.has(k)) console.log(JSON.stringify(k), '//', f);
  } else {
    for (const [k] of [...keys].sort((a, b) => a[0].localeCompare(b[0]))) console.log(JSON.stringify(k));
    console.error(keys.size, 'frasi');
  }
}
