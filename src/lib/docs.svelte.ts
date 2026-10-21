/**
 * Documento aperto: apertura, salvataggio automatico, conflitti, note.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { backend, basename, dialogs, dirname, extname, joinPath, normPath, relativeTo, revealInFolder, safeFileName, stripExt } from './backend';
import { converter } from './convert/client';
import { readEpub, readHtml } from './convert/epub';
import { editor, type EditorLanguage } from './editor/controller';
import { makeAnchor, resolveAnchor } from './notes/anchor';
import { closePdfDocument, extractPdfText, openPdf } from './reader/pdf';
import { exportTo } from './exporter';
import { keys, locale, t, tn } from './i18n';
import {
  doc,
  libraryData,
  newId,
  notesStore,
  notify,
  readState,
  rekey,
  rememberRecent,
  save,
  session,
  setReadState,
  settings,
  ui,
  type DocFormat,
  type DocRef,
  type Note,
  type ReadKind,
  type SaveFormat,
  leaveGuard,
} from './state.svelte';

export const EDITABLE = ['md', 'markdown', 'txt', 'tex', 'typ'];
export const READABLE = ['pdf', 'epub', 'html', 'htm'];
/** Filtri del dialogo «Apri», nella lingua dell'interfaccia. */
export function openFilters() {
  return [
    { name: t('Documenti supportati'), extensions: ['md', 'markdown', 'txt', 'tex', 'typ', 'pdf', 'epub', 'html', 'htm'] },
    { name: 'Markdown', extensions: ['md', 'markdown'] },
    { name: t('Testo'), extensions: ['txt'] },
    { name: t('LaTeX e Typst'), extensions: ['tex', 'typ'] },
    { name: t('PDF ed EPUB'), extensions: ['pdf', 'epub'] },
    { name: 'HTML', extensions: ['html', 'htm'] },
  ];
}

/** PDF aperto (per la vista a pagine). */
export const reader = $state<{ pdf: PDFDocumentProxy | null; loading: string | null }>({ pdf: null, loading: null });

let currentText = '';
let version = 0;
let savedVersion = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let analyzeTimer: ReturnType<typeof setTimeout> | undefined;
let positionTimer: ReturnType<typeof setTimeout> | undefined;
let savePromise: Promise<void> | null = null;

export function keyForPath(path: string): string {
  const rel = relativeTo(settings.libraryRoot, path);
  return rel ? 'lib:' + rel : 'file:' + normPath(path);
}

export function displayName(name: string): string {
  return stripExt(name);
}

function formatOf(ext: string): DocFormat {
  if (ext === 'markdown') return 'md';
  if (ext === 'htm') return 'html';
  return ext as DocFormat;
}

function languageOf(format: DocFormat, mode: 'edit' | 'read'): EditorLanguage {
  if (mode === 'read') return 'md';
  return format === 'html' ? 'html' : format;
}

/** Testo semplice (non Markdown): i file .txt. */
export function isPlainText(): boolean {
  return doc.format === 'txt' && doc.mode === 'edit';
}

/* ───────────────────────────── Note ───────────────────────────── */

export function notesFor(key: string): Note[] {
  return notesStore.list.filter((n) => n.docKey === key);
}

/** Ricolloca le note sul testo appena aperto. */
function resolveNotes(key: string, text: string) {
  const ranges = [];
  for (const n of notesStore.list) {
    if (n.docKey !== key) continue;
    const r = resolveAnchor(text, n);
    if (r) {
      n.from = r.from;
      n.to = r.to;
      n.orphan = false;
      ranges.push({ id: n.id, from: r.from, to: r.to });
    } else n.orphan = true;
  }
  return ranges;
}

/** Copia nelle note le posizioni aggiornate dall'editor. */
export function syncNotes() {
  if (!doc.key) return;
  const text = editor.getText();
  const ranges = editor.noteRanges();
  let changed = false;
  for (const r of ranges) {
    const n = notesStore.list.find((x) => x.id === r.id);
    if (!n) continue;
    if (r.to <= r.from) {
      // Il testo annotato è stato cancellato: la nota resta, senza ancoraggio.
      n.orphan = true;
      editor.removeNoteRange(r.id);
      changed = true;
      continue;
    }
    if (n.from !== r.from || n.to !== r.to || n.quote !== text.slice(r.from, r.to)) {
      Object.assign(n, makeAnchor(text, r.from, r.to));
      n.orphan = false;
      changed = true;
    }
  }
  if (changed) save.notes();
}

export function createNote(sel: { from: number; to: number }, text: string): Note | null {
  const body = editor.getText();
  const n: Note = {
    id: newId(),
    docKey: doc.key,
    docName: doc.draftId ? doc.title || t('Senza titolo') : doc.name,
    docPath: doc.path,
    ...makeAnchor(body, sel.from, sel.to),
    text: text.trim(),
    created: Date.now(),
    updated: Date.now(),
  };
  notesStore.list.push(n);
  editor.addNoteRange({ id: n.id, from: n.from, to: n.to });
  save.notes();
  return n;
}

export function updateNote(id: string, text: string) {
  const n = notesStore.list.find((x) => x.id === id);
  if (!n || n.text === text.trim()) return;
  n.text = text.trim();
  n.updated = Date.now();
  save.notes();
}

export function deleteNote(id: string) {
  deleteNotes([id]);
}

/** Elimina una o più note, con la possibilità di annullare. */
export function deleteNotes(ids: string[]) {
  const wanted = new Set(ids);
  if (!wanted.size) return;
  syncNotes();
  const removed: { index: number; note: Note }[] = [];
  for (let i = notesStore.list.length - 1; i >= 0; i--) {
    const n = notesStore.list[i];
    if (!wanted.has(n.id)) continue;
    removed.unshift({ index: i, note: $state.snapshot(n) as Note });
    notesStore.list.splice(i, 1);
    if (n.docKey === doc.key) editor.removeNoteRange(n.id);
  }
  if (!removed.length) return;
  if (ui.popover?.noteId && wanted.has(ui.popover.noteId)) ui.popover = null;
  save.notes();
  notify(tn(removed.length, 'Nota eliminata.', '{n} note eliminate.'), 'info', {
    label: t('Annulla'),
    run: () => {
      for (const { index, note } of removed) {
        notesStore.list.splice(Math.min(index, notesStore.list.length), 0, note);
        if (note.docKey === doc.key && !note.orphan) editor.addNoteRange({ id: note.id, from: note.from, to: note.to });
      }
      save.notes();
    },
  });
}

/**
 * Copia le note di un documento su un altro (per «Salva come copia»): le note
 * originali restano sull'originale, l'editor mostra quelle della copia.
 */
function duplicateNotesTo(fromKey: string, toKey: string, toName: string, toPath: string | null) {
  syncNotes();
  const map = new Map<string, string>();
  const copies: Note[] = [];
  for (const n of notesStore.list) {
    if (n.docKey !== fromKey) continue;
    const id = newId();
    map.set(n.id, id);
    copies.push({ ...$state.snapshot(n), id, docKey: toKey, docName: toName, docPath: toPath, created: Date.now(), updated: Date.now() });
  }
  if (!copies.length) return;
  notesStore.list.push(...copies);
  editor.setNoteRanges(editor.noteRanges().filter((r) => map.has(r.id)).map((r) => ({ ...r, id: map.get(r.id)! })));
  save.notes();
}

/* ───────────────────────────── Modifiche e salvataggio ───────────────────────────── */

editor.onChange(() => {
  version++;
  if (doc.mode !== 'edit') return;
  doc.dirty = true;
  if (doc.derived) doc.derived.pending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), 900);
  scheduleAnalyze();
});

editor.onScroll(() => {
  clearTimeout(positionTimer);
  positionTimer = setTimeout(() => {
    if (!doc.key) return;
    libraryData.positions[doc.key] = editor.topPosition();
    save.library();
  }, 600);
});

export function scheduleAnalyze(delay = 250) {
  clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(async () => {
    const r = await converter.analyze(editor.getText(), displayName(doc.name), isPlainText()).catch(() => null);
    if (!r) return;
    doc.words = r.words;
    doc.chars = r.chars;
    doc.title = r.title;
    if (doc.draftId) {
      if (session.drafts[doc.draftId]) session.drafts[doc.draftId].title = r.title;
      // Le note di una bozza portano il titolo che la bozza ha in quel momento.
      for (const n of notesStore.list) if (n.docKey === doc.key && n.docName !== r.title) n.docName = r.title;
    }
  }, delay);
}

/** Salva subito il documento se ci sono modifiche. */
export async function saveNow(opts: { force?: boolean; announce?: boolean } = {}): Promise<void> {
  clearTimeout(saveTimer);
  if (savePromise) await savePromise;
  if (doc.mode !== 'edit' || !doc.key) return;
  if (!doc.dirty && !opts.force) {
    if (opts.announce) notify(t('Già salvato.'), 'ok');
    return;
  }
  const text = editor.getText();
  const v = version;
  doc.saving = true;
  savePromise = (async () => {
    try {
      if (doc.draftId) {
        if (!text.trim() && !session.drafts[doc.draftId]) {
          // Una bozza mai scritta non va conservata.
        } else {
          await backend.draftSave(doc.draftId, text);
          const dir = draftDirs.get(doc.draftId);
          session.drafts[doc.draftId] = { ...session.drafts[doc.draftId], ...(dir ? { dir } : {}), title: doc.title || t('Senza titolo'), updated: Date.now() };
          save.session();
        }
      } else if (doc.path) {
        if (!opts.force) {
          const info = await backend.fileInfo(doc.path);
          if (!info.exists) {
            showConflict('missing');
            return;
          }
          if (doc.modifiedMs && info.modified_ms && info.modified_ms !== doc.modifiedMs) {
            showConflict('changed');
            return;
          }
        }
        doc.modifiedMs = await backend.writeText(doc.path, text, doc.encoding === 'utf-8-bom');
        if (doc.encoding !== 'utf-8' && doc.encoding !== 'utf-8-bom') {
          doc.encoding = 'utf-8';
          doc.banner = null;
        }
      }
      savedVersion = v;
      if (version === v) doc.dirty = false;
      doc.savedAt = Date.now();
      doc.error = null;
      if (doc.banner?.kind === 'warn' && doc.banner.id === 'save-error') doc.banner = null;
      syncNotes();
      if (opts.announce) notify(t('Salvato.'), 'ok');
    } catch (e) {
      const msg = (e as Error).message;
      if (doc.error !== msg) notify(t('Salvataggio non riuscito: {message}', { message: msg }), 'error');
      doc.error = msg;
      doc.banner = {
        id: 'save-error',
        kind: 'warn',
        text: t('Salvataggio non riuscito: {message}. Il testo resta nell\'editor.', { message: msg }),
        actions: [
          { label: t('Riprova'), run: () => void saveNow({ announce: true }) },
          { label: t('Salva con nome…'), run: () => void saveAs() },
        ],
      };
    } finally {
      doc.saving = false;
    }
  })();
  await savePromise;
  savePromise = null;
}

function showConflict(kind: 'changed' | 'missing') {
  doc.saving = false;
  doc.banner =
    kind === 'changed'
      ? {
          kind: 'warn',
          text: t('Il file è stato modificato fuori da Wrambi. Le tue modifiche non sono ancora state salvate.'),
          actions: [
            { label: t('Ricarica dal disco'), run: () => void reloadFromDisk() },
            { label: t('Sovrascrivi'), run: () => void saveNow({ force: true, announce: true }).then(() => (doc.banner = null)) },
            { label: t('Salva con nome…'), run: () => void saveAs() },
          ],
        }
      : {
          kind: 'warn',
          text: t('Il file non si trova più nel suo percorso (spostato o eliminato).'),
          actions: [
            { label: t('Ricrea qui'), run: () => void saveNow({ force: true, announce: true }).then(() => (doc.banner = null)) },
            { label: t('Salva con nome…'), run: () => void saveAs() },
          ],
        };
}

async function reloadFromDisk() {
  if (!doc.path) return;
  const path = doc.path;
  doc.dirty = false;
  doc.banner = null;
  await openPath(path, { skipFlush: true });
}

/** "Salva con nome": per le bozze diventa un file vero. */
export async function saveAs(): Promise<boolean> {
  if (doc.mode !== 'edit') {
    notify(t('Per salvare il testo di un documento in lettura usa Esporta.'), 'info');
    return false;
  }
  const baseDir = doc.path ? dirname(doc.path) : (settings.libraryRoot ?? settings.exportDir ?? undefined);
  const ext = doc.format === 'html' ? 'html' : doc.format;
  const name = safeFileName(doc.title || displayName(doc.name) || t('Senza titolo')) + '.' + ext;
  const filters =
    doc.format === 'md' || doc.format === 'txt'
      ? [
          { name: 'Markdown', extensions: ['md'] },
          { name: t('Testo semplice'), extensions: ['txt'] },
        ]
      : [{ name: doc.format.toUpperCase(), extensions: [ext] }];
  const dest = await dialogs.saveFile(t('Salva con nome'), baseDir ? joinPath(baseDir, name) : name, filters);
  if (!dest) return false;
  try {
    const text = editor.getText();
    const modified = await backend.writeText(dest, text);
    const oldKey = doc.key;
    const newKey = keyForPath(dest);
    syncNotes();
    rekey(oldKey, newKey, basename(dest), dest);
    if (doc.draftId) {
      await backend.draftDelete(doc.draftId).catch(() => {});
      delete session.drafts[doc.draftId];
    }
    const newExt = extname(dest);
    Object.assign(doc, {
      key: newKey,
      name: basename(dest),
      path: dest,
      draftId: null,
      format: EDITABLE.includes(newExt) ? formatOf(newExt) : doc.format,
      encoding: 'utf-8',
      modifiedMs: modified,
      dirty: false,
      savedAt: Date.now(),
      banner: null,
      error: null,
    });
    rememberRecent(refOf());
    notify(t('Salvato come {name}.', { name: basename(dest) }), 'ok');
    return true;
  } catch (e) {
    notify(t('Salvataggio non riuscito: {message}', { message: (e as Error).message }), 'error');
    return false;
  }
}

function refOf(): DocRef {
  return { key: doc.key, name: doc.name, path: doc.path, draftId: doc.draftId, mode: doc.mode, opened: Date.now() };
}

/** Salva tutto prima di cambiare documento o chiudere. */
export async function flushDocument() {
  clearTimeout(positionTimer);
  if (doc.key) {
    libraryData.positions[doc.key] = editor.topPosition();
    save.library();
  }
  syncNotes();
  if (doc.dirty) await saveNow();
  if (doc.derived?.targetFormat && doc.derived.pending) {
    await writeDerived().catch((e) => notify(t('Il file non è stato aggiornato: {message}', { message: (e as Error).message }), 'error'));
  }
}

/* ───────────────────────────── Apertura ───────────────────────────── */

function loadIntoEditor(text: string, lang: EditorLanguage, ro: boolean, key: string) {
  currentText = text;
  const ranges = resolveNotes(key, text);
  editor.load(text, lang, ro, ranges, { spellcheck: settings.spellcheck, typewriter: settings.typewriter, caret: settings.caret });
  editor.configure({ focusDim: ui.focus && settings.focusDim });
  version = savedVersion = 0;
  const pos = libraryData.positions[key];
  requestAnimationFrame(() => {
    if (pos) editor.scrollToPosition(pos);
    else editor.scrollToRatio(0);
    if (!ro) editor.focus();
  });
  scheduleAnalyze(0);
}

function resetDoc(partial: Partial<typeof doc>) {
  Object.assign(doc, {
    key: '',
    name: t('Senza titolo'),
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
    ...partial,
  });
}

/** Cartella in cui salvare le bozze create da una cartella della biblioteca. */
const draftDirs = new Map<string, string>();

export function draftDir(id: string | null): string | null {
  if (!id) return null;
  return draftDirs.get(id) ?? session.drafts[id]?.dir ?? null;
}

export async function newDraft(initial = '', dir?: string) {
  if (!(await canLeave())) return;
  await flushDocument();
  closePdf();
  const id = newId();
  if (dir) draftDirs.set(id, dir);
  resetDoc({ key: 'draft:' + id, draftId: id, name: t('Senza titolo') });
  loadIntoEditor(initial, 'md', false, doc.key);
  if (initial) {
    doc.dirty = true;
    void saveNow();
  }
  rememberRecent(refOf());
}

export async function openDraft(id: string) {
  if (!(await canLeave())) return;
  if (session.drafts[id]?.origin) return openDerivedDraft(id);
  const text = await backend.draftLoad(id).catch(() => null);
  if (text == null) {
    notify(t('La bozza non esiste più.'), 'error');
    delete session.drafts[id];
    save.session();
    return;
  }
  await flushDocument();
  closePdf();
  resetDoc({ key: 'draft:' + id, draftId: id, name: session.drafts[id]?.title || t('Senza titolo'), savedAt: session.drafts[id]?.updated ?? null });
  loadIntoEditor(text, 'md', false, doc.key);
  rememberRecent(refOf());
}

/** Un'attività in corso (la modifica di un PDF) può chiedere di restare sul documento. */
async function canLeave(): Promise<boolean> {
  return leaveGuard.fn ? leaveGuard.fn() : true;
}

function closePdf() {
  if (reader.pdf) {
    closePdfDocument(reader.pdf);
    reader.pdf = null;
  }
}

export async function openPath(path: string, opts: { skipFlush?: boolean; asSource?: boolean } = {}) {
  if (!(await canLeave())) return;
  const ext = extname(path);
  if (!EDITABLE.includes(ext) && !READABLE.includes(ext)) {
    notify(t('Wrambi non apre i file .{ext}.', { ext }), 'error');
    return;
  }
  if (!opts.skipFlush) await flushDocument();
  const key = keyForPath(path);
  const name = basename(path);
  const asSource = opts.asSource && (ext === 'html' || ext === 'htm');

  try {
    if (EDITABLE.includes(ext) || asSource) {
      const file = await backend.readText(path);
      closePdf();
      const format = formatOf(ext);
      resetDoc({ key, name, path, format, mode: 'edit', encoding: file.encoding, modifiedMs: file.modified_ms });
      if (file.encoding !== 'utf-8' && file.encoding !== 'utf-8-bom') {
        doc.banner = {
          kind: 'info',
          text: t('Il file è in codifica {encoding}. Al primo salvataggio Wrambi lo scriverà in UTF-8.', { encoding: file.encoding.toUpperCase() }),
        };
      }
      loadIntoEditor(file.text, languageOf(format, 'edit'), false, key);
    } else {
      reader.loading = t('Apertura di {name}…', { name });
      let text = '';
      let readKind: ReadKind;
      let banner: (typeof doc)['banner'] = null;
      let pdfPages = 0;
      let pdf: PDFDocumentProxy | null = null;
      if (ext === 'pdf') {
        readKind = 'pdf';
        const bytes = await backend.readBinary(path);
        pdf = await openPdf(bytes);
        const res = await extractPdfText(pdf, (d, total) => (reader.loading = t('Estrazione del testo: pagina {n} di {total}', { n: d, total })));
        text = res.text;
        pdfPages = res.pages;
        banner = {
          kind: 'info',
          text:
            res.emptyPages === res.pages
              ? t('Questo PDF non contiene testo estraibile (probabilmente è una scansione). Puoi leggerlo nella vista Pagine e modificarne le pagine, ma non annotarlo.')
              : t('Testo estratto dal PDF: impaginazione, immagini e formule non sono riprodotte. Le note si collegano a questo testo. Per l\'aspetto originale usa la vista Pagine; «Modifica il PDF» cambia le pagine conservando l\'impaginazione.'),
        };
      } else if (ext === 'epub') {
        readKind = 'epub';
        const book = readEpub(await backend.readBinary(path));
        text = book.text;
        banner = { kind: 'info', text: tn(book.chapters, 'EPUB in lettura: {n} sezione. Lo stile originale del libro non è riprodotto.', 'EPUB in lettura: {n} sezioni. Lo stile originale del libro non è riprodotto.') };
      } else {
        readKind = 'html';
        const page = readHtml((await backend.readText(path)).text);
        text = page.text;
        banner = {
          kind: 'info',
          text: t('Pagina HTML mostrata come testo leggibile. «Modifica» lavora sul testo; per il codice HTML apri il sorgente.'),
          actions: [{ label: t('Apri il sorgente HTML'), run: () => void openPath(path, { asSource: true }) }],
        };
      }
      closePdf();
      reader.pdf = pdf;
      resetDoc({ key, name, path, format: 'md', mode: 'read', readKind, banner, pdfPages, pdfView: 'text' });
      loadIntoEditor(text, 'md', true, key);
      offerResume(path);
    }
  } catch (e) {
    notify(t('Impossibile aprire {name}: {message}', { name, message: (e as Error).message }), 'error');
    return;
  } finally {
    reader.loading = null;
  }

  // Stato di lettura: chi apre un documento della biblioteca lo sta leggendo.
  if (settings.autoReading && readState(key) === 'unread' && (doc.mode === 'read' || key.startsWith('lib:'))) {
    setReadState(key, 'reading');
  }
  rememberRecent(refOf());
}

export async function openWithDialog() {
  const dir = doc.path ? dirname(doc.path) : (settings.libraryRoot ?? undefined);
  const path = await dialogs.pickFile(t('Apri un documento'), openFilters(), dir);
  if (path) await openPath(path);
}

/** Riapre l'ultimo documento della sessione precedente. */
export async function restoreSession() {
  const cur = session.current;
  if (cur?.draftId && session.drafts[cur.draftId]) {
    await openDraft(cur.draftId);
    return;
  }
  if (cur?.path) {
    const info = await backend.fileInfo(cur.path).catch(() => null);
    if (info?.exists) {
      await openPath(cur.path, { skipFlush: true });
      if (doc.key) return;
    }
  }
  await newDraft();
}

/** Testo attuale del documento (per esportazioni e vault). */
export function currentDocumentText(): string {
  return editor.getText();
}

export function hasUnsavedChanges(): boolean {
  return doc.dirty && version !== savedVersion;
}

export { currentText };

/** Apre il documento di una nota e la mostra nel testo. */
export async function openNoteContext(note: Note) {
  if (note.docKey !== doc.key) {
    if (note.docKey.startsWith('draft:')) await openDraft(note.docKey.slice(6));
    else {
      const path = note.docKey.startsWith('lib:') && settings.libraryRoot ? joinPath(settings.libraryRoot, note.docKey.slice(4)) : note.docPath;
      if (!path) {
        notify(t('Non so più dove si trova il documento di questa nota.'), 'error');
        return false;
      }
      const info = await backend.fileInfo(path);
      if (!info.exists) {
        notify(t('Il documento «{name}» non si trova più in {path}.', { name: note.docName, path }), 'error');
        return false;
      }
      await openPath(path);
    }
    if (note.docKey !== doc.key) return false;
  }
  if (doc.readKind === 'pdf') doc.pdfView = 'text';
  return true;
}

/* ─────────────── Modifica di PDF, EPUB e HTML (versione modificabile del testo) ─────────────── */

const TEXT_FORMATS: SaveFormat[] = ['md', 'txt', 'tex', 'typ'];
const KIND_OF: Partial<Record<SaveFormat, ReadKind>> = { pdf: 'pdf', epub: 'epub', html: 'html' };

function derivedBanner() {
  const what = doc.readKind?.toUpperCase() ?? '';
  doc.banner = doc.derived?.targetFormat
    ? {
        kind: 'info',
        text: t('Modifica di «{name}». Il testo si conserva da solo; {keys} aggiorna il file {format}.', { name: doc.name, keys: keys('Ctrl+S'), format: doc.derived.targetFormat.toUpperCase() }),
        actions: [{ label: t('Salva come…'), run: () => (ui.saveSheet = true) }],
      }
    : {
        kind: 'info',
        text: t('Stai modificando il testo di «{name}». Le modifiche si conservano da sole; con Salva ({keys}) scegli se creare una copia modificata o aggiornare il {format} originale.', { name: doc.name, keys: keys('Ctrl+S'), format: what }),
        actions: [
          { label: t('Salva…'), run: () => (ui.saveSheet = true) },
          { label: t('Annulla le modifiche'), run: () => void discardDerived() },
        ],
      };
}

/** Rende modificabile il testo di un documento aperto in lettura. */
export async function startEditing() {
  if (doc.mode !== 'read' || !doc.path || !doc.readKind) return;
  const id = newId();
  const kind = doc.readKind;
  doc.draftId = id;
  doc.derived = { kind, targetFormat: null, pending: false };
  doc.mode = 'edit';
  doc.format = 'md';
  doc.pdfView = 'text';
  session.drafts[id] = { title: doc.title || displayName(doc.name), updated: Date.now(), origin: { path: doc.path, kind, targetFormat: null } };
  editor.setEditable(true, 'md', { spellcheck: settings.spellcheck, typewriter: settings.typewriter });
  // Gli indicatori di pagina servono per leggere, non fanno parte del testo da salvare.
  if (kind === 'pdf') editor.deleteLinesMatching(/^\[p\. \d+\]$/);
  doc.dirty = true;
  await saveNow();
  derivedBanner();
  rememberRecent(refOf());
}

/** Riprende la modifica conservata di un PDF, EPUB o HTML. */
export async function openDerivedDraft(id: string) {
  const info = session.drafts[id];
  const text = await backend.draftLoad(id).catch(() => null);
  if (!info?.origin || text == null) {
    notify(t('La modifica conservata non esiste più.'), 'error');
    delete session.drafts[id];
    save.session();
    return;
  }
  await flushDocument();
  closePdf();
  const { path, kind, targetFormat } = info.origin;
  resetDoc({
    key: keyForPath(path),
    name: basename(path),
    path,
    draftId: id,
    format: 'md',
    mode: 'edit',
    readKind: kind,
    savedAt: info.updated,
    derived: { kind, targetFormat, pending: false },
  });
  loadIntoEditor(text, 'md', false, doc.key);
  derivedBanner();
  rememberRecent(refOf());
}

/** Se c'è una modifica conservata di questo file, la propone. */
function offerResume(path: string) {
  const found = Object.entries(session.drafts).find(([, d]) => d.origin && normPath(d.origin.path) === normPath(path));
  if (!found) return;
  const [id, d] = found;
  doc.banner = {
    kind: 'info',
    text: d.origin!.targetFormat
      ? t('Hai una versione modificabile di questo documento (ultima modifica {date}).', { date: new Date(d.updated).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }) })
      : t('Hai modifiche a questo documento non ancora salvate in un file.'),
    actions: [
      { label: t('Riprendi la modifica'), run: () => void openDerivedDraft(id) },
      { label: t('Scarta'), run: () => void dropDraft(id).then(() => (doc.banner = null)) },
    ],
  };
}

async function dropDraft(id: string) {
  await backend.draftDelete(id).catch(() => {});
  delete session.drafts[id];
  save.session();
}

/** Abbandona la modifica e torna al documento in lettura. */
export async function discardDerived() {
  if (!doc.derived || !doc.path) return;
  const ok = await dialogs.ask(t('Annullare le modifiche fatte al testo? Il file originale resta com\'era.'), t('Annulla le modifiche'), t('Continua a modificare'));
  if (!ok) return;
  const path = doc.path;
  if (doc.draftId) await dropDraft(doc.draftId);
  doc.dirty = false;
  doc.derived = null;
  doc.draftId = null;
  await openPath(path, { skipFlush: true });
}

/** Riscrive il file nel formato scelto (Ctrl+S dopo il primo salvataggio). */
export async function writeDerived(announce = false) {
  if (!doc.derived?.targetFormat || !doc.path) return;
  if (doc.dirty) await saveNow();
  await exportTo(doc.derived.targetFormat, doc.path, { notes: false });
  doc.derived.pending = false;
  doc.savedAt = Date.now();
  if (announce) notify(t('Salvato in {name}.', { name: doc.name }), 'ok');
}

export interface SaveChoice {
  format: SaveFormat;
  dest: string;
  /** Il file di destinazione è quello aperto (aggiorna l'originale). */
  replace: boolean;
  /** Prima di aggiornare l'originale, conserva una copia accanto. */
  backup: boolean;
}

/**
 * Salva il documento in un file: copia «nome_modificato», aggiornamento
 * dell'originale o percorso scelto. Dopo il salvataggio si continua a
 * lavorare sul file salvato; le note vengono copiate su di esso.
 */
export async function saveChanges(c: SaveChoice): Promise<string | null> {
  if (doc.mode !== 'edit') return null;
  if (doc.dirty) await saveNow();
  syncNotes();
  const derivedText = !!doc.derived;
  const wasDraft = !derivedText && !!doc.draftId;
  const oldKey = doc.key;
  const newKey = keyForPath(c.dest);
  const name = basename(c.dest);

  let backupPath: string | null = null;
  if (c.replace && c.backup && doc.path) backupPath = await backend.copyBeside(doc.path, t('originale'));

  let modified: number | null = null;
  if (derivedText) await exportTo(c.format, c.dest, { notes: false });
  else modified = await backend.writeText(c.dest, editor.getText(), doc.encoding === 'utf-8-bom');

  if (newKey !== oldKey) {
    if (wasDraft) {
      // Una bozza diventa il file: le note la seguono.
      rekey(oldKey, newKey, name, c.dest);
    } else {
      // Una copia: l'originale tiene le sue note, la copia ne riceve un duplicato.
      duplicateNotesTo(oldKey, newKey, name, c.dest);
      const st = readState(oldKey);
      if (readState(newKey) === 'unread' && st !== 'unread') setReadState(newKey, st);
    }
  }

  if (!derivedText || c.format === 'md') {
    // Il file contiene esattamente il testo dell'editor: si continua a lavorare lì.
    if (doc.draftId) await dropDraft(doc.draftId);
    const ext = extname(c.dest);
    const format: DocFormat = derivedText ? 'md' : EDITABLE.includes(ext) ? formatOf(ext) : doc.format;
    if (modified == null) modified = (await backend.fileInfo(c.dest)).modified_ms;
    if (format !== doc.format || derivedText) editor.setEditable(true, languageOf(format, 'edit'), { spellcheck: settings.spellcheck, typewriter: settings.typewriter });
    Object.assign(doc, {
      key: newKey,
      name,
      path: c.dest,
      draftId: null,
      derived: null,
      readKind: null,
      format,
      modifiedMs: modified,
      dirty: false,
      error: null,
      savedAt: Date.now(),
      banner: null,
    });
  } else if (TEXT_FORMATS.includes(c.format)) {
    // Testo semplice, LaTeX o Typst: il file è una conversione, si apre quello.
    if (doc.draftId) await dropDraft(doc.draftId);
    doc.dirty = false;
    doc.derived = null;
    doc.draftId = null;
    await openPath(c.dest, { skipFlush: true });
  } else {
    // PDF, EPUB o HTML: la bozza resta il testo da modificare, Ctrl+S riscrive il file.
    const kind = KIND_OF[c.format]!;
    Object.assign(doc, { key: newKey, name, path: c.dest, readKind: kind, savedAt: Date.now(), error: null });
    doc.derived = { kind, targetFormat: c.format, pending: false };
    if (doc.draftId) {
      session.drafts[doc.draftId] = { ...session.drafts[doc.draftId], origin: { path: c.dest, kind, targetFormat: c.format } };
      save.session();
    }
    derivedBanner();
  }
  rememberRecent(refOf());
  if (settings.libraryRoot && relativeTo(settings.libraryRoot, c.dest) != null) {
    void import('./library.svelte').then((m) => m.scanLibrary({ quiet: true }));
  }
  notify(backupPath ? t('Salvato. L\'originale è conservato come {name}.', { name: basename(backupPath) }) : t('Salvato: {name}', { name }), 'ok', {
    label: t('Mostra nella cartella'),
    run: () => void revealInFolder(c.dest),
  });
  return c.dest;
}

/** Nome proposto per la copia: «nome_modificato.ext». */
export function modifiedName(ext: string): string {
  const base = doc.path ? stripExt(basename(doc.path)) : safeFileName(doc.title || t('Documento'));
  return `${base}_${t('modificato')}.${ext}`;
}
