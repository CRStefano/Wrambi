import { describe, expect, it } from 'vitest';
import { makeAnchor, resolveAnchor } from '../src/lib/notes/anchor';

const text = 'Il tempo è la misura del movimento. Il tempo, scrive Agostino, è distensione dell\'anima.';

describe('ancoraggio delle note', () => {
  it('ritrova la selezione nel testo invariato', () => {
    const from = text.indexOf('misura');
    const a = makeAnchor(text, from, from + 6);
    expect(a.quote).toBe('misura');
    expect(resolveAnchor(text, a)).toEqual({ from, to: from + 6 });
  });

  it('segue il testo spostato da modifiche esterne', () => {
    const from = text.indexOf('distensione');
    const a = makeAnchor(text, from, from + 'distensione'.length);
    const edited = 'Premessa aggiunta. ' + text;
    const r = resolveAnchor(edited, a)!;
    expect(edited.slice(r.from, r.to)).toBe('distensione');
  });

  it('sceglie l\'occorrenza con il contesto giusto', () => {
    // "Il tempo" compare due volte: la nota è sulla seconda.
    const second = text.indexOf('Il tempo', 5);
    const a = makeAnchor(text, second, second + 8);
    const edited = 'Nota: Il tempo vola. ' + text;
    const r = resolveAnchor(edited, a)!;
    expect(r.from).toBe(edited.indexOf('Il tempo, scrive'));
  });

  it('tollera spazi e a capo diversi', () => {
    const from = text.indexOf('misura del movimento');
    const a = makeAnchor(text, from, from + 'misura del movimento'.length);
    const edited = text.replace('misura del movimento', 'misura\ndel  movimento');
    const r = resolveAnchor(edited, a)!;
    expect(edited.slice(r.from, r.to)).toBe('misura\ndel  movimento');
  });

  it('restituisce null se il testo annotato non c\'è più', () => {
    const from = text.indexOf('Agostino');
    const a = makeAnchor(text, from, from + 8);
    expect(resolveAnchor(text.replace('Agostino', 'Platone'), a)).toBeNull();
  });
});
