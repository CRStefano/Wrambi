/**
 * Biblioteca: indice della cartella scelta dall'utente.
 */
import { formatNumber, t, tk } from './i18n';
import { backend } from './backend';
import { notify, save, settings, ui } from './state.svelte';

let lastScan = 0;

export async function scanLibrary(opts: { quiet?: boolean } = {}) {
  const root = settings.libraryRoot;
  if (!root || ui.libraryScanning) return;
  ui.libraryScanning = true;
  try {
    const res = await backend.libraryScan(root);
    ui.libraryEntries = res.entries;
    ui.libraryTruncated = res.truncated;
    ui.libraryError = null;
    lastScan = Date.now();
    if (!opts.quiet && res.truncated) notify(t('La biblioteca contiene molti file: ne sono indicizzati i primi {n}.', { n: formatNumber(res.entries.length) }), 'info');
  } catch (e) {
    ui.libraryError = (e as Error).message;
    ui.libraryEntries = [];
  } finally {
    ui.libraryScanning = false;
  }
}

/** Aggiorna l'elenco quando si torna su Wrambi, se è passato un po' di tempo. */
export function refreshIfStale() {
  if (Date.now() - lastScan > 20_000) void scanLibrary({ quiet: true });
}

export async function setLibraryRoot(path: string) {
  settings.libraryRoot = path;
  save.settings();
  await scanLibrary();
}

export const TYPE_LABELS: Record<string, string> = {
  md: 'Markdown',
  markdown: 'Markdown',
  txt: tk('Testo'),
  html: 'HTML',
  htm: 'HTML',
  tex: 'LaTeX',
  typ: 'Typst',
  pdf: 'PDF',
  epub: 'EPUB',
};
