/**
 * Ancoraggio delle note al testo.
 *
 * Una nota ricorda la posizione della selezione, il testo selezionato e un
 * po' di contesto prima e dopo. Se il documento cambia fuori da Wrambi, la
 * nota viene ricollocata cercando lo stesso testo nel contesto più simile.
 */

export interface Anchor {
  from: number;
  to: number;
  quote: string;
  prefix: string;
  suffix: string;
}

const CONTEXT = 40;

export function makeAnchor(text: string, from: number, to: number): Anchor {
  return {
    from,
    to,
    quote: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT), from),
    suffix: text.slice(to, to + CONTEXT),
  };
}

/** Lunghezza del suffisso comune di a e b. */
function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ritrova la posizione della nota nel testo attuale.
 * Restituisce `null` se il testo annotato non esiste più.
 */
export function resolveAnchor(text: string, a: Anchor): { from: number; to: number } | null {
  if (!a.quote) return null;
  if (text.slice(a.from, a.to) === a.quote) return { from: a.from, to: a.to };

  const candidates: { from: number; to: number }[] = [];
  let idx = text.indexOf(a.quote);
  while (idx !== -1 && candidates.length < 500) {
    candidates.push({ from: idx, to: idx + a.quote.length });
    idx = text.indexOf(a.quote, idx + 1);
  }
  if (!candidates.length) {
    // Tollera differenze di spazi e a capo (es. testo riformattato).
    const pattern = a.quote.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
    if (!pattern) return null;
    const re = new RegExp(pattern, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) && candidates.length < 500) {
      candidates.push({ from: m.index, to: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  if (!candidates.length) return null;

  let best = candidates[0];
  let bestScore = -Infinity;
  for (const c of candidates) {
    const before = text.slice(Math.max(0, c.from - a.prefix.length), c.from);
    const after = text.slice(c.to, c.to + a.suffix.length);
    const context = commonSuffix(before, a.prefix) + commonPrefix(after, a.suffix);
    // Il contesto pesa più della distanza dalla posizione originale.
    const score = context * 1000 - Math.abs(c.from - a.from) / 1000;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
