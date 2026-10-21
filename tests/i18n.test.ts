import { describe, expect, it } from 'vitest';
// @ts-expect-error: script Node senza tipi
import { collectKeys } from '../scripts/i18n-keys.mjs';
import { en } from '../src/lib/i18n/en';
import { fr } from '../src/lib/i18n/fr';

const keys: Map<string, string> = collectKeys('src');
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('traduzioni dell\'interfaccia', () => {
  it('trova le frasi usate nel codice', () => {
    expect(keys.size).toBeGreaterThan(400);
    expect(keys.has('Nuovo documento')).toBe(true);
  });

  for (const [name, dict] of [
    ['inglese', en],
    ['francese', fr],
  ] as const) {
    it(`ogni frase ha la traduzione ${name}`, () => {
      const missing = [...keys].filter(([k]) => !(k in dict)).map(([k, file]) => `${k}  (${file})`);
      expect(missing).toEqual([]);
    });

    it(`le traduzioni ${name} hanno gli stessi segnaposto`, () => {
      const wrong = Object.entries(dict).filter(([k, v]) => placeholders(k).join() !== placeholders(v).join());
      expect(wrong).toEqual([]);
    });

    it(`nessuna traduzione ${name} vuota o superflua`, () => {
      expect(Object.entries(dict).filter(([, v]) => !v.trim())).toEqual([]);
      expect(Object.keys(dict).filter((k) => !keys.has(k))).toEqual([]);
    });
  }
});
