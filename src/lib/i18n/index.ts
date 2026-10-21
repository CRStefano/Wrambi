/**
 * Lingue dell'interfaccia: italiano (lingua di partenza), inglese, francese.
 *
 * Le chiavi sono le frasi italiane stesse: `t('Nuovo documento')`. Così il
 * codice resta leggibile e una frase non ancora tradotta compare in italiano
 * invece che vuota. I parametri si scrivono tra graffe: `t('Salvato: {name}', { name })`.
 * Il test `tests/i18n.test.ts` verifica che ogni frase usata abbia la sua
 * traduzione in inglese e in francese.
 */
import { settings, uiLocale } from '../state.svelte';
import { en } from './en';
export { tk } from './keys';
import { fr } from './fr';

export type Lang = 'it' | 'en' | 'fr';

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'it', label: 'Italiano' },
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
];

const DICTS: Record<Exclude<Lang, 'it'>, Record<string, string>> = { en, fr };

/** Traduce una frase italiana nella lingua scelta. */
export function t(key: string, params?: Record<string, string | number>): string {
  const lang = settings.language;
  let s = lang === 'it' ? key : (DICTS[lang]?.[key] ?? key);
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] != null ? String(params[k]) : m));
  return s;
}

/** Singolare o plurale (le tre lingue hanno due forme; in francese anche 0 è singolare). */
export function tn(n: number, one: string, many: string, params: Record<string, string | number> = {}): string {
  const singular = settings.language === 'fr' ? Math.abs(n) < 2 : n === 1;
  return t(singular ? one : many, { n: formatNumber(n), ...params });
}

/** Formato regionale della lingua dell'interfaccia (date e numeri). */
export function locale(): string {
  return uiLocale();
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(locale()).format(n);
}

export { systemLanguage } from '../platform';

import { IS_MAC } from '../platform';
export { IS_MAC };

/** Scorciatoie come le mostra il sistema: su Mac ⌘, ⌥, ⇧. */
export function keys(combo: string): string {
  if (!IS_MAC) return combo;
  return combo
    .replace(/Ctrl\+/g, '⌘')
    .replace(/Alt\+/g, '⌥')
    .replace(/Shift\+/g, '⇧')
    .replace(/Ctrl/g, '⌘');
}

/** Un tasto come lo chiama il sistema: su Mac Ctrl → ⌘, Alt → ⌥, Shift → ⇧. */
export function keyName(k: string): string {
  if (!IS_MAC) return k;
  return ({ Ctrl: '⌘', Alt: '⌥', Shift: '⇧' } as Record<string, string>)[k] ?? k;
}

/** Lingue dei documenti (controllo ortografico, sillabazione nei PDF, termini delle bibliografie). */
export const DOC_LANGS: { id: string; label: string }[] = [
  { id: 'it', label: 'Italiano' },
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' },
  { id: 'pt', label: 'Português' },
];
