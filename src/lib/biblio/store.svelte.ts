/**
 * La bibliografia scelta nelle impostazioni (un file .bib o CSL JSON, per
 * esempio esportato da Zotero). Si rilegge solo quando il file cambia: con
 * Better BibTeX, Zotero lo tiene aggiornato da solo.
 */
import { backend, basename } from '../backend';
import { converter } from '../convert/client';
import { t } from '../i18n';
import { settings } from '../state.svelte';
import { parseBibtex } from './bibtex';
import { parseCslJson } from './csl';
import { BibIndex } from './format';
import type { BibEntry } from './model';

export const biblio = $state<{
  /** File letto per ultimo. */
  path: string | null;
  count: number;
  error: string | null;
  modified: number;
}>({ path: null, count: 0, error: null, modified: 0 });

let index: BibIndex | null = null;
const listeners: (() => void)[] = [];
let loading: Promise<void> | null = null;
let checkedAt = 0;
let checkedPath: string | null = null;

/** Indice della bibliografia caricata (null se non ce n'è una). */
export function bibIndex(): BibIndex | null {
  return index;
}

/** Avvisa quando la bibliografia cambia (per ridisegnare le citazioni nell'editor). */
export function onBibliographyChange(fn: () => void): () => void {
  listeners.push(fn);
  return () => listeners.splice(listeners.indexOf(fn) >>> 0, 1);
}

function changed() {
  for (const fn of listeners) fn();
}

export function parseBibliography(path: string, text: string): BibEntry[] {
  const trimmed = text.trimStart();
  if (/\.json$/i.test(path) || trimmed.startsWith('[') || trimmed.startsWith('{')) return parseCslJson(text);
  return parseBibtex(text);
}

async function load(force: boolean) {
  const path = settings.bibliography;
  if (!path) {
    if (index || biblio.path) {
      index = null;
      Object.assign(biblio, { path: null, count: 0, error: null, modified: 0 });
      await converter.setBibliography(null);
    }
    return;
  }
  try {
    const info = await backend.fileInfo(path);
    if (!info.exists) {
      index = null;
      Object.assign(biblio, { path, count: 0, modified: 0, error: t('Il file della bibliografia non si trova più: {name}', { name: basename(path) }) });
      await converter.setBibliography(null);
      return;
    }
    if (!force && biblio.path === path && biblio.modified === info.modified_ms && !biblio.error) return;
    const file = await backend.readText(path);
    const entries = parseBibliography(path, file.text);
    index = new BibIndex(entries);
    Object.assign(biblio, { path, count: index.size, modified: info.modified_ms, error: null });
    await converter.setBibliography(entries);
  } catch (e) {
    index = null;
    Object.assign(biblio, {
      path,
      count: 0,
      modified: 0,
      error: t('La bibliografia non si legge: {message}', { message: e instanceof Error ? e.message : String(e) }),
    });
    await converter.setBibliography(null);
  }
}

/** Carica la bibliografia, o la rilegge se il file è cambiato. */
export function refreshBibliography(force = false): Promise<void> {
  // L'anteprima chiede a ogni modifica: il file si controlla al massimo ogni 3 secondi.
  const now = Date.now();
  if (!force && !loading && checkedPath === settings.bibliography && now - checkedAt < 3000) return Promise.resolve();
  checkedAt = now;
  checkedPath = settings.bibliography;
  // Una lettura alla volta: chi arriva durante una lettura aspetta quella.
  if (!loading) {
    const before = index;
    loading = load(force).finally(() => {
      loading = null;
      if (index !== before) changed();
    });
  }
  return loading;
}
