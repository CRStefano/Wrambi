/**
 * Stato dell'applicazione (Svelte 5, rune).
 *
 * Impostazioni, biblioteca, note e sessione sono salvati come JSON nella
 * cartella dati dell'app. Il testo del documento aperto vive nell'editor.
 */
import { backend } from './backend';
import { IS_MAC, IS_WINDOWS, PLATFORM, systemLanguage } from './platform';
import { tk } from './i18n/keys';
// Ciclo voluto: i18n legge `settings` solo dentro le funzioni, quindi l'ordine di caricamento non conta.
import { t } from './i18n';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type FontId =
  | 'literata'
  | 'source-serif'
  | 'plex-sans'
  | 'atkinson'
  | 'jetbrains'
  | 'cambria'
  | 'georgia'
  | 'constantia'
  | 'palatino'
  | 'segoe'
  | 'consolas'
  | 'charter'
  | 'iowan'
  | 'sf'
  | 'menlo'
  | 'noto-serif'
  | 'dejavu-serif'
  | 'noto-sans'
  | 'dejavu-mono';
export type CaretStyle = 'system' | 'thick';
export type Measure = 'narrow' | 'medium' | 'wide';
export type ReadState = 'unread' | 'reading' | 'read';
export type PreviewFormat = 'html' | 'pdf' | 'typ' | 'tex' | 'txt';

type FontDef = { id: FontId; label: string; family: string; note: string; group: 'system' | 'wrambi' };

/**
 * Caratteri dell'editor. Quelli del sistema sono disegnati per lo schermo
 * (su Windows con hinting ClearType): a 100–125% di zoom risultano i più nitidi.
 * Le note sono chiavi di traduzione (`t(f.note)`).
 */
const SYSTEM_FONTS: Record<typeof PLATFORM, FontDef[]> = {
  windows: [
    { id: 'cambria', group: 'system', label: 'Cambria', family: "Cambria, 'Literata Variable', Georgia, serif", note: tk('Serif da lettura, molto nitido') },
    { id: 'georgia', group: 'system', label: 'Georgia', family: "Georgia, 'Literata Variable', serif", note: tk('Serif classico per lo schermo') },
    { id: 'constantia', group: 'system', label: 'Constantia', family: "Constantia, Georgia, serif", note: tk('Serif morbido, da libro') },
    { id: 'palatino', group: 'system', label: 'Palatino Linotype', family: "'Palatino Linotype', Palatino, 'Book Antiqua', serif", note: tk('Serif rinascimentale') },
    { id: 'segoe', group: 'system', label: 'Segoe UI', family: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif", note: tk('Il carattere del sistema') },
    { id: 'consolas', group: 'system', label: 'Consolas', family: "Consolas, 'JetBrains Mono Variable', monospace", note: tk('Monospaziato del sistema') },
  ],
  macos: [
    { id: 'charter', group: 'system', label: 'Charter', family: "Charter, 'Bitstream Charter', 'Literata Variable', serif", note: tk('Serif da lettura, molto nitido') },
    { id: 'iowan', group: 'system', label: 'Iowan Old Style', family: "'Iowan Old Style', 'Literata Variable', serif", note: tk('Serif morbido, da libro') },
    { id: 'georgia', group: 'system', label: 'Georgia', family: "Georgia, 'Literata Variable', serif", note: tk('Serif classico per lo schermo') },
    { id: 'palatino', group: 'system', label: 'Palatino', family: "Palatino, 'Palatino Linotype', serif", note: tk('Serif rinascimentale') },
    { id: 'sf', group: 'system', label: 'San Francisco', family: "-apple-system, system-ui, 'Helvetica Neue', sans-serif", note: tk('Il carattere del sistema') },
    { id: 'menlo', group: 'system', label: 'Menlo', family: "Menlo, 'SF Mono', 'JetBrains Mono Variable', monospace", note: tk('Monospaziato del sistema') },
  ],
  linux: [
    { id: 'noto-serif', group: 'system', label: 'Noto Serif', family: "'Noto Serif', 'Literata Variable', serif", note: tk('Serif da lettura, molto nitido') },
    { id: 'dejavu-serif', group: 'system', label: 'DejaVu Serif', family: "'DejaVu Serif', 'Literata Variable', serif", note: tk('Serif classico per lo schermo') },
    { id: 'georgia', group: 'system', label: 'Georgia', family: "Georgia, 'Gelasio', 'Literata Variable', serif", note: tk('Serif classico per lo schermo') },
    { id: 'noto-sans', group: 'system', label: 'Noto Sans', family: "'Noto Sans', system-ui, 'DejaVu Sans', sans-serif", note: tk('Il carattere del sistema') },
    { id: 'dejavu-mono', group: 'system', label: 'DejaVu Sans Mono', family: "'DejaVu Sans Mono', 'JetBrains Mono Variable', monospace", note: tk('Monospaziato del sistema') },
  ],
};

export const FONTS: FontDef[] = [
  ...SYSTEM_FONTS[PLATFORM],
  { id: 'literata', group: 'wrambi', label: 'Literata', family: "'Literata Variable', Georgia, serif", note: tk('Serif pensato per leggere a lungo') },
  { id: 'source-serif', group: 'wrambi', label: 'Source Serif', family: "'Source Serif 4 Variable', Georgia, serif", note: tk('Serif sobrio, da saggio') },
  { id: 'plex-sans', group: 'wrambi', label: 'IBM Plex Sans', family: "'IBM Plex Sans Variable', system-ui, sans-serif", note: tk('Sans-serif nitido') },
  {
    id: 'atkinson',
    group: 'wrambi',
    label: 'Atkinson Hyperlegible',
    family: "'Atkinson Hyperlegible Next Variable', system-ui, sans-serif",
    note: tk('Massima leggibilità'),
  },
  { id: 'jetbrains', group: 'wrambi', label: 'JetBrains Mono', family: "'JetBrains Mono Variable', ui-monospace, monospace", note: tk('Monospaziato, da macchina da scrivere') },
];

/** La famiglia CSS di un carattere, anche se scelto su un altro sistema (impostazioni copiate). */
export function fontFamily(id: FontId): string {
  const all = Object.values(SYSTEM_FONTS).flat();
  return FONTS.find((f) => f.id === id)?.family ?? all.find((f) => f.id === id)?.family ?? FONTS[0].family;
}

export const MEASURES: Record<Measure, string> = { narrow: '58ch', medium: '68ch', wide: '84ch' };

export interface Settings {
  version: 2;
  firstRunDone: boolean;
  libraryRoot: string | null;
  theme: ThemeChoice;
  font: FontId;
  fontSize: number;
  lineHeight: number;
  measure: Measure;
  caret: CaretStyle;
  spellcheck: boolean;
  typewriter: boolean;
  focusDim: boolean;
  autoReading: boolean;
  previewFormat: PreviewFormat;
  exportDir: string | null;
  systemFonts: boolean;
  homeView: 'grid' | 'list';
  homeSort: HomeSort;
  /** «windows»: cornice e pulsanti di Windows; «wrambi»: una sola barra integrata. */
  titleBar: 'windows' | 'wrambi';
  /** Lingua dell'interfaccia. */
  language: 'it' | 'en' | 'fr';
  /** Lingua dei documenti: controllo ortografico, sillabazione, termini delle bibliografie. */
  docLanguage: string;
  /** File della bibliografia (.bib di BibTeX/BibLaTeX o CSL JSON, per esempio esportato da Zotero). */
  bibliography: string | null;
  /** Nelle esportazioni, le note di Wrambi diventano note a piè di pagina. */
  exportNotes: boolean;
}

export type HomeSort = 'modified' | 'name' | 'type';

export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  firstRunDone: false,
  libraryRoot: null,
  theme: 'system',
  // Su Windows il carattere predefinito è Cambria, disegnato per ClearType; su Mac Charter.
  font: IS_WINDOWS ? 'cambria' : IS_MAC ? 'charter' : 'literata',
  fontSize: 19,
  lineHeight: 1.7,
  measure: 'medium',
  caret: 'system',
  spellcheck: true,
  typewriter: false,
  focusDim: true,
  autoReading: true,
  previewFormat: 'html',
  exportDir: null,
  systemFonts: false,
  homeView: 'grid',
  homeSort: 'modified',
  titleBar: 'windows',
  language: 'it',
  docLanguage: 'it',
  bibliography: null,
  exportNotes: false,
};

export interface Note {
  id: string;
  docKey: string;
  docName: string;
  /** Percorso del documento quando la nota è stata creata (per riaprirlo). */
  docPath?: string | null;
  from: number;
  to: number;
  quote: string;
  prefix: string;
  suffix: string;
  text: string;
  created: number;
  updated: number;
  /** Il testo annotato non è stato ritrovato nel documento. */
  orphan?: boolean;
}

export interface DocRef {
  key: string;
  name: string;
  path: string | null;
  draftId: string | null;
  mode: 'edit' | 'read';
  opened: number;
}

export interface LibraryData {
  version: 1;
  states: Record<string, ReadState>;
  positions: Record<string, number>;
}

/** Formati in cui si può salvare un documento. */
export type SaveFormat = 'md' | 'txt' | 'html' | 'pdf' | 'epub' | 'tex' | 'typ';

export interface DraftInfo {
  title: string;
  updated: number;
  /** Cartella in cui proporre il salvataggio (bozze create dentro una cartella). */
  dir?: string | null;
  /**
   * Bozza che contiene la versione modificabile di un PDF, EPUB o HTML:
   * il file a cui si riferisce e il formato in cui Ctrl+S lo riscrive.
   */
  origin?: { path: string; kind: ReadKind; targetFormat: SaveFormat | null };
}

export interface SessionData {
  version: 1;
  current: DocRef | null;
  recent: DocRef[];
  drafts: Record<string, DraftInfo>;
}

/** Modifica del testo di un documento che si apre in lettura (PDF, EPUB, HTML). */
export interface DerivedEdit {
  kind: ReadKind;
  /** Formato in cui Ctrl+S scrive il file; null finché non si sceglie come salvare. */
  targetFormat: SaveFormat | null;
  /** Testo cambiato dopo l'ultima scrittura del file. */
  pending: boolean;
}

/* ───────────────────────────── Stato ───────────────────────────── */

export const settings = $state<Settings>({ ...DEFAULT_SETTINGS });
export const libraryData = $state<LibraryData>({ version: 1, states: {}, positions: {} });
export const notesStore = $state<{ list: Note[] }>({ list: [] });
export const session = $state<SessionData>({ version: 1, current: null, recent: [], drafts: {} });

export type DocFormat = 'md' | 'txt' | 'tex' | 'typ' | 'html';
export type ReadKind = 'pdf' | 'epub' | 'html';
export type HomeSection = 'all' | 'recent' | 'drafts' | 'notes' | 'unread' | 'reading' | 'read' | 'folder';

export interface OpenDoc {
  key: string;
  name: string;
  path: string | null;
  draftId: string | null;
  format: DocFormat;
  mode: 'edit' | 'read';
  readKind: ReadKind | null;
  encoding: string;
  modifiedMs: number;
  dirty: boolean;
  saving: boolean;
  savedAt: number | null;
  error: string | null;
  /** Avviso persistente sul documento (codifica, conflitto…). */
  banner: { id?: string; kind: 'info' | 'warn'; text: string; actions?: { label: string; run: () => void }[] } | null;
  title: string;
  words: number;
  chars: number;
  /** PDF: vista pagine o testo. */
  pdfView: 'pages' | 'text';
  pdfPages: number;
  derived: DerivedEdit | null;
}

export const doc = $state<OpenDoc>({
  key: '',
  name: 'Senza titolo',
  path: null,
  draftId: null,
  format: 'md',
  mode: 'edit',
  readKind: null,
  encoding: 'utf-8',
  modifiedMs: 0,
  dirty: false,
  saving: false,
  savedAt: null,
  error: null,
  banner: null,
  title: '',
  words: 0,
  chars: 0,
  pdfView: 'text',
  pdfPages: 0,
  derived: null,
});

export interface MenuItem {
  label: string;
  run: () => unknown;
  icon?: 'open' | 'edit' | 'delete' | 'export';
  danger?: boolean;
  separatorBefore?: boolean;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'ok' | 'error';
  action?: { label: string; run: () => void };
}

export const ui = $state({
  ready: false,
  notes: false,
  preview: false,
  settings: false,
  exportOpen: false,
  saveSheet: false,
  /** Vista Biblioteca a tutta finestra. */
  home: false,
  homeSection: 'all' as HomeSection,
  homeFolder: null as string | null,
  vault: false,
  shortcuts: false,
  about: false,
  menu: false,
  focus: false,
  fullscreen: false,
  dnd: false,
  firstRun: false,
  link: null as null | { text: string; href: string; from: number; to: number },
  /** Finestra per inserire una citazione. */
  cite: false,
  toasts: [] as Toast[],
  queued: [] as Toast[],
  /** Menu contestuale (tasto destro) con le sue voci. */
  contextMenu: null as null | { x: number; y: number; items: MenuItem[] },
  /** Nota aperta nel riquadro a comparsa. */
  popover: null as null | { noteId: string | null; draft?: { from: number; to: number; quote: string }; x: number; y: number; below: boolean },
  resolvedTheme: 'light' as 'light' | 'dark',
  libraryEntries: [] as import('./backend').LibraryEntry[],
  libraryScanning: false,
  libraryError: null as string | null,
  libraryTruncated: false,
  selectionEmpty: true,
});

/** Chiamata prima di lasciare il documento aperto: false per restare (modifiche non salvate). */
export const leaveGuard: { fn: null | (() => Promise<boolean>) } = { fn: null };

/* ───────────────────────────── Avvisi ───────────────────────────── */

let toastId = 0;

export function notify(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
  const t: Toast = { id: ++toastId, text, kind, action };
  // In "Non disturbare" gli avvisi informativi aspettano; gli errori no.
  if (ui.dnd && kind !== 'error') {
    ui.queued.push(t);
    return;
  }
  ui.toasts.push(t);
  setTimeout(() => dismiss(t.id), kind === 'error' ? 9000 : action ? 7000 : 3800);
}

export function dismiss(id: number) {
  const i = ui.toasts.findIndex((t) => t.id === id);
  if (i >= 0) ui.toasts.splice(i, 1);
}

export function setDoNotDisturb(on: boolean) {
  ui.dnd = on;
  if (!on && ui.queued.length) {
    const n = ui.queued.length;
    const last = ui.queued[ui.queued.length - 1];
    ui.queued = [];
    notify(n === 1 ? last.text : t('{n} avvisi arrivati mentre scrivevi. L\'ultimo: {last}', { n, last: last.text }), 'info');
  }
}

/* ───────────────────────────── Persistenza ───────────────────────────── */

const timers: Record<string, ReturnType<typeof setTimeout>> = {};

function persist(name: 'settings' | 'library' | 'notes' | 'session', value: () => unknown, delay = 400) {
  clearTimeout(timers[name]);
  timers[name] = setTimeout(() => {
    backend.storeSave(name, JSON.stringify(value())).catch((e) => notify(t('Impossibile salvare i dati ({name}): {message}', { name, message: e.message }), 'error'));
  }, delay);
}

export const save = {
  settings: () => persist('settings', () => $state.snapshot(settings)),
  library: () => persist('library', () => $state.snapshot(libraryData)),
  notes: () => persist('notes', () => $state.snapshot(notesStore.list)),
  session: () => persist('session', () => $state.snapshot(session)),
};

/** Scrive subito tutto ciò che è in attesa (alla chiusura). */
export async function flushPersistence() {
  const pending: Promise<void>[] = [];
  for (const [name, t] of Object.entries(timers)) {
    clearTimeout(t);
    const value =
      name === 'settings'
        ? $state.snapshot(settings)
        : name === 'library'
          ? $state.snapshot(libraryData)
          : name === 'notes'
            ? $state.snapshot(notesStore.list)
            : $state.snapshot(session);
    pending.push(backend.storeSave(name as 'settings', JSON.stringify(value)).catch(() => {}));
    delete timers[name];
  }
  await Promise.all(pending);
}

function parseJson<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export async function loadAll() {
  const [s, l, n, se] = await Promise.all([
    backend.storeLoad('settings'),
    backend.storeLoad('library'),
    backend.storeLoad('notes'),
    backend.storeLoad('session'),
  ]);
  const stored = parseJson<Partial<Settings> & { version?: number }>(s) ?? {};
  // Versione 1 → 2: chi aveva il vecchio carattere predefinito passa a quello più nitido su Windows.
  if ((stored.version ?? 1) < 2 && stored.font === 'literata' && IS_WINDOWS) stored.font = 'cambria';
  // Lingua: chi usava già Wrambi resta in italiano; al primo avvio, quella del sistema.
  if (!stored.language) {
    stored.language = stored.firstRunDone ? 'it' : systemLanguage();
    if (!stored.docLanguage) stored.docLanguage = stored.firstRunDone ? 'it' : stored.language;
  }
  Object.assign(settings, { ...DEFAULT_SETTINGS, ...stored, version: 2 });
  const lib = parseJson<LibraryData>(l);
  if (lib) Object.assign(libraryData, { version: 1, states: lib.states ?? {}, positions: lib.positions ?? {} });
  notesStore.list = parseJson<Note[]>(n) ?? [];
  const ses = parseJson<SessionData>(se);
  if (ses) Object.assign(session, { version: 1, current: ses.current ?? null, recent: ses.recent ?? [], drafts: ses.drafts ?? {} });
}

/* ───────────────────────────── Utilità ───────────────────────────── */

export function newId(): string {
  if ('randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function readState(key: string): ReadState {
  return libraryData.states[key] ?? 'unread';
}

export function setReadState(key: string, state: ReadState) {
  if (state === 'unread') delete libraryData.states[key];
  else libraryData.states[key] = state;
  save.library();
}

export const READ_LABELS: Record<ReadState, string> = {
  unread: tk('Non letto'),
  reading: tk('In lettura'),
  read: tk('Letto'),
};

/** Sposta note, stato e posizione da una chiave all'altra (es. bozza salvata come file). */
export function rekey(oldKey: string, newKey: string, newName: string, newPath: string | null = null) {
  if (oldKey === newKey) return;
  for (const n of notesStore.list) {
    if (n.docKey === oldKey) {
      n.docKey = newKey;
      n.docName = newName;
      n.docPath = newPath;
    }
  }
  if (libraryData.states[oldKey]) {
    libraryData.states[newKey] = libraryData.states[oldKey];
    delete libraryData.states[oldKey];
  }
  if (libraryData.positions[oldKey] != null) {
    libraryData.positions[newKey] = libraryData.positions[oldKey];
    delete libraryData.positions[oldKey];
  }
  save.notes();
  save.library();
}

export function rememberRecent(ref: DocRef) {
  // Le bozze vuote mai salvate non restano tra i recenti.
  const alive = (r: DocRef) => !!r.path || !r.draftId || !!session.drafts[r.draftId];
  session.recent = [ref, ...session.recent.filter((r) => r.key !== ref.key && alive(r))].slice(0, 20);
  session.current = ref;
  save.session();
}

export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Formato regionale della lingua dell'interfaccia (date, numeri). */
export function uiLocale(): string {
  return ({ it: 'it-IT', en: 'en-GB', fr: 'fr-FR' } as const)[settings.language] ?? 'it-IT';
}

export function formatDate(ms: number): string {
  const loc = uiLocale();
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) {
    const word = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' }).format(0, 'day');
    return `${word}, ${d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString(loc, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function formatSize(bytes: number): string {
  const n = (v: number, digits = 0) => new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: digits }).format(v);
  if (bytes < 1024) return `${n(bytes)} B`;
  if (bytes < 1024 * 1024) return `${n(bytes / 1024)} KB`;
  return `${n(bytes / (1024 * 1024), 1)} MB`;
}
