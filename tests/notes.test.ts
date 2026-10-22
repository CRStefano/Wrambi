import { describe, expect, it, vi } from 'vitest';
// Il convertitore lavora in un worker, che qui non serve.
vi.mock('../src/lib/convert/client', () => ({ converter: {} }));
import { notesMarkdown } from '../src/lib/notes/export';
import type { Note } from '../src/lib/state.svelte';

const note = (over: Partial<Note>): Note => ({
  id: Math.random().toString(36).slice(2),
  docKey: 'lib:Saggi/Saggio.pdf',
  docName: 'Saggio.pdf',
  from: 0,
  to: 10,
  quote: 'il tempo vissuto',
  prefix: '',
  suffix: '',
  text: '',
  created: 0,
  updated: 0,
  ...over,
});

describe('esportazione delle note', () => {
  it('le evidenziazioni compaiono come passi evidenziati, con il commento se c’è', () => {
    const md = notesMarkdown(
      [
        note({ from: 0, quote: 'la misura', text: 'Una nota vera.' }),
        note({ from: 20, quote: 'il tempo vissuto', kind: 'highlight' }),
        note({ from: 40, quote: 'la durata', kind: 'highlight', text: 'Bergson' }),
      ],
      'Note',
      new Date(2026, 9, 22),
    );
    expect(md).toContain('> la misura\n\nUna nota vera.');
    expect(md).toContain('> il tempo vissuto\n\n*Evidenziato*');
    expect(md).toContain('> la durata\n\n*Evidenziato:* Bergson');
  });
});
