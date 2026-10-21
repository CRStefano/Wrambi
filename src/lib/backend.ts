/**
 * Ponte verso il nucleo Rust di Wrambi.
 *
 * Dentro l'app (Tauri) ogni funzione chiama un comando Rust. Aperta in un
 * normale browser (`npm run dev`) l'interfaccia usa una simulazione in
 * memoria, utile solo per lavorare sull'aspetto: nessun file reale viene toccato.
 */
import { invoke } from '@tauri-apps/api/core';

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface TextFile {
  text: string;
  encoding: string;
  modified_ms: number;
}
export interface FileInfo {
  exists: boolean;
  is_dir: boolean;
  size: number;
  modified_ms: number;
}
export interface LibraryEntry {
  rel: string;
  path: string;
  name: string;
  ext: string;
  folder: string;
  size: number;
  modified_ms: number;
}
export interface ScanResult {
  root: string;
  entries: LibraryEntry[];
  truncated: boolean;
  skipped_unreadable: number;
}
export interface Diagnostic {
  error: boolean;
  message: string;
  line: number | null;
  hints: string[];
}
export interface TypstPreview {
  pdf: string | null;
  pages: number;
  diagnostics: Diagnostic[];
}
export interface TypstExport {
  ok: boolean;
  pages: number;
  diagnostics: Diagnostic[];
}
export interface VaultData {
  settings: string | null;
  library: string | null;
  notes: string | null;
}
export interface VaultFileIn {
  key: string;
  name: string;
  path?: string | null;
  text?: string | null;
}
export interface RestoredFile {
  key: string;
  name: string;
  original_path: string | null;
  new_path: string | null;
  text: string | null;
}
export interface VaultImport {
  created: string;
  data: VaultData;
  restored: RestoredFile[];
}
export interface AppInfo {
  version: string;
  data_dir: string;
  platform: string;
}

/* ───────────── Simulazione per il browser (solo sviluppo dell'interfaccia) ───────────── */

/** Documenti di esempio della simulazione nel browser (testi originali). */
const MOCK_TEXTS: Record<string, string> = {
  'Appunti/Lezione di logica.md':
    '# Lezione di logica\n\nIl **modus ponens** è una regola di inferenza: da un condizionale e dal suo antecedente si conclude il conseguente.\n\n- Se *p* allora *q*\n- *p*\n- dunque *q*\n\n## Validità e verità\n\nUn argomento è **valido** quando la verità delle premesse garantisce quella della conclusione. Un argomento valido può avere premesse false: la validità riguarda la forma, non il contenuto.\n\n> Nessuna regola ci dice da sola quali premesse accettare.\n',
  'Appunti/Idee per il saggio.txt':
    'Idee per il saggio.\n\nIl tempo come misura del cambiamento: che cosa contiamo quando contiamo.\n\nLa persistenza degli oggetti e la persistenza delle teorie: due problemi o uno solo?\n\nRileggere gli appunti sulla nozione di informazione semantica.\n',
  'Tesi/Capitolo 1 - Introduzione.typ':
    '#set page(paper: "a4")\n#set text(lang: "it")\n= Introduzione\n\nQuesta tesi si chiede come un sistema fisico possa *portare* un contenuto, cioè essere vero o falso di qualcosa.\n\n== Il problema\n\nUn segnale non è vero in sé: lo diventa nel ruolo che svolge per chi lo usa.\n\n- primo obiettivo: distinguere informazione e significato;\n- secondo obiettivo: proporre un criterio funzionale.\n',
  'Tesi/Capitolo 2 - Metodo.tex':
    '\\documentclass{article}\n\\title{Metodo}\n\\begin{document}\n\\maketitle\n\\section{Fonti e strumenti}\nIl lavoro combina analisi concettuale e modelli formali. % da rivedere\n\\section{Struttura}\nOgni capitolo parte da un caso e ne ricava un criterio.\n\\begin{itemize}\n\\item casi semplici;\n\\item casi limite;\n\\item obiezioni.\n\\end{itemize}\n\\end{document}\n',
  'Web/Identità e persistenza.html':
    '<!doctype html><html lang="it"><head><title>Identità e persistenza</title><style>body{font-family:serif}</style></head><body><h1>Identità e persistenza</h1><p>Una pagina di appunti sul problema della persistenza degli oggetti attraverso il cambiamento.</p><h2>Il problema</h2><p>Che cosa resta identico quando un oggetto cambia alcune proprietà?</p><ul><li>endurantismo</li><li>perdurantismo</li></ul></body></html>',
};

const mem = {
  store: new Map<string, string>(),
  drafts: new Map<string, { text: string; t: number }>(),
  thumbs: new Map<string, string>(),
  files: new Map<string, string>(Object.entries(MOCK_TEXTS).map(([rel, text]) => ['C:/Biblioteca/' + rel, text])),
  /** File binari scritti nell'anteprima (base64), per poterli riaprire. */
  binaries: new Map<string, string>(),
};

// Per i test automatici dell'interfaccia nel browser.
if (!inTauri && typeof window !== 'undefined') (window as unknown as { __wrambiMock: typeof mem }).__wrambiMock = mem;

function mockEntries(): LibraryEntry[] {
  const names: [string, number][] = [
    ['Appunti/Lezione di logica.md', 2400],
    ['Appunti/Idee per il saggio.txt', 800],
    ['Libri/Il giardino delle ipotesi.epub', 68_900],
    ['Libri/Lettere sul metodo.epub', 1_900],
    ['Articoli/Informazione e significato.pdf', 21_800],
    ['Articoli/La misura del tempo.pdf', 13_400],
    ['Articoli/Note sulla persistenza.pdf', 18_300],
    ['Tesi/Capitolo 1 - Introduzione.typ', 12_000],
    ['Tesi/Capitolo 2 - Metodo.tex', 9_000],
    ['Web/Identità e persistenza.html', 21_000],
  ];
  return names.map(([rel, size], i) => {
    const name = rel.split('/').pop()!;
    return {
      rel,
      path: 'C:/Biblioteca/' + rel,
      name,
      ext: name.split('.').pop()!.toLowerCase(),
      folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
      size,
      modified_ms: Date.now() - i * 86_400_000,
    };
  });
}

async function mock(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 5));
  switch (cmd) {
    case 'app_info':
      return { version: '0.2.0 (anteprima browser)', data_dir: '(memoria del browser)', platform: 'web' };
    case 'store_load':
      return mem.store.get(args.name as string) ?? localStorage.getItem('wrambi:' + args.name);
    case 'store_save':
      mem.store.set(args.name as string, args.json as string);
      try {
        localStorage.setItem('wrambi:' + args.name, args.json as string);
      } catch {
        /* spazio esaurito: solo memoria */
      }
      return null;
    case 'draft_save':
      mem.drafts.set(args.id as string, { text: args.text as string, t: Date.now() });
      return null;
    case 'draft_load':
      return mem.drafts.get(args.id as string)?.text ?? null;
    case 'draft_delete':
      mem.drafts.delete(args.id as string);
      return null;
    case 'draft_list':
      return [...mem.drafts.entries()].map(([id, v]) => ({ id, modified_ms: v.t }));
    case 'read_text_file': {
      const t = mem.files.get(args.path as string);
      if (t == null) throw `${args.path}: non trovato`;
      return { text: t, encoding: 'utf-8', modified_ms: 1 };
    }
    case 'write_text_file':
      mem.files.set(args.path as string, args.text as string);
      return 1;
    case 'write_binary_file':
      mem.files.set(args.path as string, `(file binario simulato, ${(args.base64 as string).length} caratteri base64)`);
      mem.binaries.set(args.path as string, args.base64 as string);
      return null;
    case 'typst_export_pdf':
      mem.files.set(args.dest as string, `(PDF simulato da ${(args.text as string).length} caratteri Typst)`);
      return { ok: true, pages: 1, diagnostics: [] };
    case 'ensure_dir':
      return null;
    case 'read_text_head': {
      const t = mem.files.get(args.path as string);
      if (t != null) return t.slice(0, (args.max as number) ?? 4096);
      const name = basename(args.path as string);
      return `# ${stripExt(name)}\n\nAnteprima simulata nel browser: nell'app qui compare l'inizio del documento.`;
    }
    case 'free_path': {
      const dir = args.dir as string;
      const name = args.name as string;
      let candidate = joinPath(dir, name);
      for (let n = 2; mem.files.has(candidate); n++) candidate = joinPath(dir, `${stripExt(name)} (${n}).${extname(name)}`);
      return candidate;
    }
    case 'copy_beside': {
      const p = args.path as string;
      const copy = joinPath(dirname(p), `${stripExt(basename(p))} (${args.suffix}).${extname(p)}`);
      mem.files.set(copy, mem.files.get(p) ?? '');
      if (mem.binaries.has(p)) mem.binaries.set(copy, mem.binaries.get(p)!);
      return copy;
    }
    case 'rename_file': {
      const p = args.path as string;
      const n = joinPath(dirname(p), args.newName as string);
      mem.files.set(n, mem.files.get(p) ?? '');
      mem.files.delete(p);
      return n;
    }
    case 'thumb_load':
      return mem.thumbs.get(args.key as string) ?? null;
    case 'thumb_save':
      mem.thumbs.set(args.key as string, args.base64 as string);
      return null;
    case 'file_info': {
      const exists = mem.files.has(args.path as string) || mockEntries().some((e) => e.path === args.path);
      return { exists, is_dir: false, size: 0, modified_ms: 1 };
    }
    case 'library_scan':
      return { root: args.root, entries: mockEntries(), truncated: false, skipped_unreadable: 0 };
    case 'typst_compile':
      return { pdf: null, pages: 0, diagnostics: [{ error: true, message: 'Il PDF si genera solo dentro l\'app Wrambi.', line: null, hints: [] }] };
    default:
      throw `Funzione disponibile solo nell'app Wrambi (${cmd}).`;
  }
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return (inTauri ? await invoke<T>(cmd, args) : ((await mock(cmd, args)) as T));
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));
  }
}

/* ───────────────────────────── API ───────────────────────────── */

export const backend = {
  appInfo: () => call<AppInfo>('app_info'),
  /** Lingua dei messaggi del programma (errori dei file, del vault, di Typst). */
  setLanguage: (lang: string) => (inTauri ? call<void>('set_language', { lang }) : Promise.resolve()),
  storeLoad: (name: 'settings' | 'library' | 'notes' | 'session') => call<string | null>('store_load', { name }),
  storeSave: (name: 'settings' | 'library' | 'notes' | 'session', json: string) => call<void>('store_save', { name, json }),
  draftSave: (id: string, text: string) => call<void>('draft_save', { id, text }),
  draftLoad: (id: string) => call<string | null>('draft_load', { id }),
  draftDelete: (id: string) => call<void>('draft_delete', { id }),
  draftList: () => call<{ id: string; modified_ms: number }[]>('draft_list'),
  readText: (path: string) => call<TextFile>('read_text_file', { path }),
  writeText: (path: string, text: string, bom = false) => call<number>('write_text_file', { path, text, bom }),
  async readBinary(path: string): Promise<Uint8Array> {
    if (!inTauri) {
      // Anteprima nel browser: i file di prova vengono serviti dai test automatici.
      const written = mem.binaries.get(path);
      if (written) return fromBase64(written);
      const r = await fetch('/__anteprima__/' + encodeURIComponent(basename(path))).catch(() => null);
      if (!r?.ok) throw new Error('La lettura di PDF ed EPUB è disponibile solo nell\'app Wrambi.');
      return new Uint8Array(await r.arrayBuffer());
    }
    try {
      const buf = await invoke<ArrayBuffer>('read_binary_file', { path });
      return new Uint8Array(buf);
    } catch (e) {
      throw new Error(typeof e === 'string' ? e : String(e));
    }
  },
  writeBinary: (path: string, bytes: Uint8Array) => call<void>('write_binary_file', { path, base64: toBase64(bytes) }),
  fileInfo: (path: string) => call<FileInfo>('file_info', { path }),
  libraryScan: (root: string) => call<ScanResult>('library_scan', { root }),
  /** `bib`: BibLaTeX servito in memoria come `wrambi-citazioni.bib`. */
  typstCompile: (text: string, root: string | null, systemFonts: boolean, bib: string | null = null) =>
    call<TypstPreview>('typst_compile', { text, root, systemFonts, bib }),
  typstExportPdf: (text: string, root: string | null, dest: string, systemFonts: boolean, bib: string | null = null) =>
    call<TypstExport>('typst_export_pdf', { text, root, dest, systemFonts, bib }),
  vaultExport: (dest: string, password: string, data: VaultData, files: VaultFileIn[]) =>
    call<{ files: number; bytes: number }>('vault_export', { dest, password, data, files }),
  vaultImport: (src: string, password: string, restoreDir: string | null) =>
    call<VaultImport>('vault_import', { src, password, restoreDir }),
  openNotificationSettings: () => call<void>('open_notification_settings'),
  ensureDir: (path: string) => call<void>('ensure_dir', { path }),
  readTextHead: (path: string, max = 4096) => call<string>('read_text_head', { path, max }),
  freePath: (dir: string, name: string) => call<string>('free_path', { dir, name }),
  copyBeside: (path: string, suffix: string) => call<string>('copy_beside', { path, suffix }),
  renameFile: (path: string, newName: string) => call<string>('rename_file', { path, newName }),
  /** Anteprima salvata come PNG (byte vuoti se assente). */
  async thumbLoad(key: string): Promise<Uint8Array | null> {
    if (!inTauri) {
      const b = (await mock('thumb_load', { key })) as string | null;
      return b ? fromBase64(b) : null;
    }
    try {
      const buf = await invoke<ArrayBuffer>('thumb_load', { key });
      const bytes = new Uint8Array(buf);
      return bytes.length ? bytes : null;
    } catch {
      return null;
    }
  },
  thumbSave: (key: string, png: Uint8Array) => call<void>('thumb_save', { key, base64: toBase64(png) }).catch(() => {}),
  /** Cornice della finestra e posizione dentro lo schermo, prima di mostrarla. */
  prepareWindow: (nativeFrame: boolean) => (inTauri ? call<void>('prepare_window', { nativeFrame }) : Promise.resolve()),
  setWindowFrame: (nativeFrame: boolean) => (inTauri ? call<void>('set_window_frame', { nativeFrame }) : Promise.resolve()),
};

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ───────────────────────────── Dialoghi di sistema ───────────────────────────── */

export interface FileFilter {
  name: string;
  extensions: string[];
}

export const dialogs = {
  async pickFolder(title: string, defaultPath?: string): Promise<string | null> {
    if (!inTauri) return prompt(title, defaultPath ?? 'C:/Biblioteca');
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ directory: true, multiple: false, title, defaultPath });
    return typeof r === 'string' ? r : null;
  },
  async pickFile(title: string, filters: FileFilter[], defaultPath?: string): Promise<string | null> {
    if (!inTauri) return prompt(title, 'C:/Biblioteca/Appunti/Lezione di logica.md');
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ multiple: false, title, filters, defaultPath });
    return typeof r === 'string' ? r : null;
  },
  async ask(message: string, okLabel: string, cancelLabel?: string): Promise<boolean> {
    cancelLabel ??= (await import('./i18n')).t('Annulla');
    if (!inTauri) return confirm(message);
    const { ask } = await import('@tauri-apps/plugin-dialog');
    return ask(message, { title: 'Wrambi', kind: 'warning', okLabel, cancelLabel });
  },
  async saveFile(title: string, defaultPath: string, filters: FileFilter[]): Promise<string | null> {
    if (!inTauri) return prompt(title, defaultPath);
    const { save } = await import('@tauri-apps/plugin-dialog');
    return (await save({ title, defaultPath, filters })) ?? null;
  },
};

export async function revealInFolder(path: string) {
  if (!inTauri) return;
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}

export async function openExternal(url: string) {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (!inTauri) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

/* ───────────────────────────── Percorsi ───────────────────────────── */

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i > 0 ? path.slice(0, i) : path;
}

export function extname(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}

export function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}

/** Normalizza per confronti (Windows non distingue maiuscole nei percorsi). */
export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Percorso relativo alla biblioteca, se il file vi è contenuto. */
export function relativeTo(root: string | null, path: string): string | null {
  if (!root) return null;
  const r = normPath(root) + '/';
  const p = path.replace(/\\/g, '/');
  if (!p.toLowerCase().startsWith(r)) return null;
  return p.slice(r.length);
}

/** Nome di file valido su Windows. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  const base = cleaned.slice(0, 120) || 'Documento';
  return reserved.test(base) ? base + '_' : base;
}
