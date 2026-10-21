/**
 * Le note di Wrambi dentro le esportazioni: ogni nota diventa una nota a piè
 * di pagina nel punto in cui finisce il testo annotato.
 */
import { NOTE_MARK } from './ast';

export interface NoteRange {
  from: number;
  to: number;
  text: string;
}

/**
 * Inserisce nel sorgente i segnaposto ⟦wn:N⟧ alla fine di ogni passo annotato.
 * Restituisce il sorgente marcato e i testi delle note (`notes[N - 1]`).
 */
export function insertNoteMarks(src: string, ranges: NoteRange[]): { src: string; notes: string[] } {
  const list = ranges
    .filter((r) => r.text.trim() && r.to > r.from && r.to <= src.length)
    .map((r) => {
      // Il richiamo va dopo l'ultima parola, non all'inizio della riga seguente.
      let at = r.to;
      while (at > r.from && /\s/.test(src[at - 1])) at--;
      return { at, from: r.from, text: r.text.trim() };
    })
    .sort((a, b) => a.at - b.at || a.from - b.from);
  let out = '';
  let pos = 0;
  const notes: string[] = [];
  list.forEach((r, i) => {
    out += src.slice(pos, r.at) + NOTE_MARK(i + 1);
    pos = r.at;
    notes.push(r.text);
  });
  return { src: out + src.slice(pos), notes };
}

/** Markdown con le note in sintassi Pandoc: `[^1]` nel testo e le definizioni in fondo. */
export function markdownFootnotes(src: string, notes: string[]): string {
  const used: number[] = [];
  const body = src.replace(/⟦wn:(\d+)⟧/g, (_, n: string) => {
    const i = Number(n);
    if (notes[i - 1] === undefined) return '';
    used.push(i);
    return `[^${used.length}]`;
  });
  if (!used.length) return body;
  const defs = used.map((i, k) => `[^${k + 1}]: ${notes[i - 1].replace(/\n/g, '\n    ')}`);
  return body.replace(/\s*$/, '') + '\n\n' + defs.join('\n') + '\n';
}
