import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  normalize,
  normalizeEditorText,
  pageText,
  pageToText,
  passageOnPages,
  selectionToText,
  textToPage,
  type PageItem,
} from '../src/lib/reader/textmap';

/** Frammenti di una pagina: una riga per frammento, dall'alto in basso. */
const page = (...lines: string[]): PageItem[] => lines.map((str, i) => ({ str, top: 0.1 + (i * 0.8) / Math.max(1, lines.length) }));

const PAGES = [
  page('Saggio sul tempo', 'Un orologio non misura il tempo come un righello misura una', 'lunghezza: conta i cambiamenti regolari di qual-', 'cosa che abbiamo preso come campione.'),
  page('Due immagini del tempo', 'Per McTaggart l’immagine comune era incoerente.', 'Bergson distingueva il tempo misurato dalla durata vissuta.'),
  page('Conclusione', 'Un messaggio riduce l’incertezza di chi lo riceve,', 'ma non dice di che cosa parli.'),
];
const INDEX = buildIndex(PAGES.map(pageText));

/** Testo estratto come lo mostra Wrambi: indicatori di pagina e Markdown. */
const EXTRACTED = `[p. 1]

# Saggio sul tempo

Un orologio non misura il tempo come un righello misura una lunghezza: conta i cambiamenti regolari di qualcosa che abbiamo preso come campione.

[p. 2]

## Due immagini del tempo

Per McTaggart l’immagine comune era incoerente.

Bergson distingueva il tempo misurato dalla durata vissuta.

[p. 3]

## Conclusione

Un messaggio riduce l’incertezza di chi lo riceve, ma non dice di che cosa parli.
`;

describe('testo ridotto', () => {
  it('tiene lettere e cifre, in minuscolo e senza accenti, e ricorda le posizioni', () => {
    const n = normalize('Perché *così*? ﬁne – 3½');
    expect(n.text).toBe('perchecosifine312');
    expect(n.map[0]).toBe(0);
    expect(n.map[5]).toBe(5); // «é»
    expect('Perché *così*? ﬁne'.slice(n.map[10], n.map[10] + 1)).toBe('ﬁ');
  });

  it('salta gli indicatori di pagina del testo estratto', () => {
    const ed = normalizeEditorText(EXTRACTED);
    expect(ed.text.startsWith('saggiosultempo')).toBe(true);
    expect(ed.text).not.toContain('p1');
    expect(ed.markers.map((m) => m.page)).toEqual([1, 2, 3]);
    expect(ed.text.slice(ed.markers[1].norm, ed.markers[1].norm + 15)).toBe('dueimmaginideltempo'.slice(0, 15));
  });
});

describe('dal testo alle pagine e ritorno', () => {
  const ed = normalizeEditorText(EXTRACTED);

  it('ritrova la pagina e l’altezza del punto del testo', () => {
    const pos = EXTRACTED.indexOf('Bergson');
    const at = textToPage(ed, pos, INDEX)!;
    expect(at.page).toBe(1);
    expect(at.top).toBeCloseTo(PAGES[1][2].top, 5);
  });

  it('una parola spezzata a fine riga si ritrova lo stesso', () => {
    const pos = EXTRACTED.indexOf('qualcosa');
    expect(textToPage(ed, pos, INDEX)!.page).toBe(0);
  });

  it('dal punto delle pagine torna al punto del testo', () => {
    const pos = pageToText(INDEX, { page: 2, top: 0.3 }, ed)!;
    expect(EXTRACTED.slice(pos, pos + 12)).toBe('Un messaggio');
    const top = pageToText(INDEX, { page: 1, top: 0 }, ed)!;
    expect(EXTRACTED.slice(top, top + 3)).toBe('Due');
  });

  it('funziona anche con un testo modificato, senza indicatori di pagina', () => {
    const edited = EXTRACTED.replace(/\[p\. \d+\]\n\n/g, '').replace('incoerente', 'del tutto incoerente');
    const e2 = normalizeEditorText(edited);
    const at = textToPage(e2, edited.indexOf('Bergson'), INDEX)!;
    expect(at.page).toBe(1);
    const back = pageToText(INDEX, { page: 2, top: 0 }, e2)!;
    expect(edited.slice(back, back + 11)).toBe('Conclusione');
  });
});

describe('passaggi sulle pagine', () => {
  it('trova la pagina di un passaggio e lo divide tra due pagine se serve', () => {
    const q = normalize('durata vissuta').text;
    const spans = passageOnPages(INDEX, q, normalize('misurato dalla ').text, '', 0);
    expect(spans).toHaveLength(1);
    expect(spans[0].page).toBe(1);
    expect(INDEX.pages[1].norm.slice(spans[0].from, spans[0].to)).toBe(q);
    const across = passageOnPages(INDEX, normalize('come campione. Due immagini').text, '', '', 0);
    expect(across.map((s) => s.page)).toEqual([0, 1]);
  });

  it('dal testo selezionato sulla pagina all’intervallo del testo', () => {
    const ed = normalizeEditorText(EXTRACTED);
    const sel = normalize('di qual-cosa che abbiamo').text;
    const g = INDEX.all.indexOf(sel);
    const r = selectionToText(ed, INDEX, sel, g)!;
    expect(EXTRACTED.slice(r.from, r.to)).toBe('di qualcosa che abbiamo');
  });
});
