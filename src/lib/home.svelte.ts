/**
 * Biblioteca a tutta finestra: documenti della cartella, bozze e note in un
 * unico posto, con le azioni su ciascun documento.
 */
import { t } from './i18n';
import { startPdfEdit } from './pdfedit/session.svelte';
import { backend, basename, dirname, extname, joinPath, normPath, relativeTo, safeFileName, stripExt, type LibraryEntry } from './backend';
import { flushDocument, keyForPath, newDraft, openDraft, openPath, startEditing } from './docs.svelte';
import { editor } from './editor/controller';
import { scanLibrary } from './library.svelte';
import { forgetThumb } from './thumbs';
import {
  doc,
  libraryData,
  notesStore,
  notify,
  readState,
  rekey,
  save,
  session,
  settings,
  ui,
  type HomeSection,
  type HomeSort,
} from './state.svelte';

/** Un documento come appare nella Biblioteca: un file della cartella o una bozza. */
export interface HomeItem {
  id: string;
  key: string;
  kind: 'file' | 'draft';
  /** Nome senza estensione. */
  title: string;
  ext: string;
  path: string | null;
  /** Cartella relativa alla biblioteca ('' = principale), o la cartella del file. */
  folder: string;
  size: number;
  modified: number;
  draftId?: string;
  /** Bozza con le modifiche di un PDF, EPUB o HTML: il nome del file. */
  editOf?: string;
  /** Le modifiche sono già state scritte in un file (Ctrl+S lo aggiorna). */
  editSaved?: boolean;
}

export function fileItem(e: LibraryEntry): HomeItem {
  return {
    id: 'lib:' + e.rel,
    key: 'lib:' + e.rel,
    kind: 'file',
    title: stripExt(e.name),
    ext: e.ext,
    path: e.path,
    folder: e.folder,
    size: e.size,
    modified: e.modified_ms,
  };
}

export function draftItems(): HomeItem[] {
  return Object.entries(session.drafts).map(([id, d]) => ({
    id: 'draft:' + id,
    key: d.origin ? keyForPath(d.origin.path) : 'draft:' + id,
    kind: 'draft' as const,
    title: d.origin ? stripExt(basename(d.origin.path)) : d.title || t('Senza titolo'),
    ext: d.origin ? (d.origin.targetFormat ?? d.origin.kind) : 'md',
    path: null,
    folder: d.dir && settings.libraryRoot ? (relativeTo(settings.libraryRoot, d.dir) ?? '') : '',
    size: 0,
    modified: d.updated,
    draftId: id,
    editOf: d.origin ? basename(d.origin.path) : undefined,
    editSaved: !!d.origin?.targetFormat,
  }));
}

/** Documenti aperti di recente, anche fuori dalla biblioteca. */
export function recentItems(entries: Map<string, HomeItem>): HomeItem[] {
  const out: HomeItem[] = [];
  const seen = new Set<string>();
  for (const r of session.recent) {
    let item: HomeItem | undefined;
    if (r.draftId && session.drafts[r.draftId]) item = draftItems().find((d) => d.draftId === r.draftId);
    else if (r.path) {
      item = entries.get(normPath(r.path));
      if (!item)
        item = {
          id: 'file:' + normPath(r.path),
          key: r.key,
          kind: 'file',
          title: stripExt(r.name),
          ext: extname(r.path),
          path: r.path,
          folder: dirname(r.path),
          size: 0,
          modified: 0,
        };
    }
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      out.push({ ...item, modified: item.modified || r.opened });
    }
  }
  return out;
}

const TYPE_ORDER = ['md', 'markdown', 'txt', 'typ', 'tex', 'html', 'htm', 'pdf', 'epub'];

export function sortItems(list: HomeItem[], sort: HomeSort): HomeItem[] {
  const coll = new Intl.Collator('it', { numeric: true, sensitivity: 'base' });
  const byName = (a: HomeItem, b: HomeItem) => coll.compare(a.title, b.title);
  const out = [...list];
  if (sort === 'name') out.sort(byName);
  else if (sort === 'type') out.sort((a, b) => TYPE_ORDER.indexOf(a.ext) - TYPE_ORDER.indexOf(b.ext) || byName(a, b));
  else out.sort((a, b) => b.modified - a.modified || byName(a, b));
  return out;
}

export function matches(item: HomeItem, q: string): boolean {
  if (!q) return true;
  const hay = `${item.title} ${item.folder} ${item.ext} ${item.editOf ?? ''}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

/* ───────────────────────────── Cartelle ───────────────────────────── */

export interface FolderNode {
  path: string;
  name: string;
  count: number;
  children: FolderNode[];
}

/** Albero delle cartelle che contengono documenti, con il conteggio (sottocartelle comprese). */
export function folderTree(entries: LibraryEntry[]): FolderNode[] {
  const root: FolderNode = { path: '', name: '', count: 0, children: [] };
  const nodes = new Map<string, FolderNode>([['', root]]);
  const ensure = (path: string): FolderNode => {
    let n = nodes.get(path);
    if (n) return n;
    const parent = ensure(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
    n = { path, name: path.slice(path.lastIndexOf('/') + 1), count: 0, children: [] };
    parent.children.push(n);
    nodes.set(path, n);
    return n;
  };
  for (const e of entries) {
    let n: FolderNode | undefined = ensure(e.folder);
    let p = e.folder;
    for (;;) {
      n = nodes.get(p);
      if (n) n.count++;
      if (!p) break;
      p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    }
  }
  const coll = new Intl.Collator('it', { numeric: true, sensitivity: 'base' });
  const sortRec = (n: FolderNode) => {
    n.children.sort((a, b) => coll.compare(a.name, b.name));
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root.children;
}

export function inFolder(item: HomeItem, folder: string, deep: boolean): boolean {
  if (deep) return item.folder === folder || item.folder.startsWith(folder + '/');
  return item.folder === folder;
}

/* ───────────────────────────── Azioni ───────────────────────────── */

export function showHome(section?: HomeSection, folder?: string | null) {
  if (section) ui.homeSection = section;
  if (folder !== undefined) ui.homeFolder = folder;
  ui.home = true;
  ui.popover = null;
  ui.menu = false;
  if (settings.libraryRoot) void scanLibrary({ quiet: true });
}

export function hideHome() {
  ui.home = false;
  requestAnimationFrame(() => {
    editor.view?.requestMeasure();
    editor.focus();
  });
}

export async function openItem(item: HomeItem, then?: 'edit' | 'export' | 'pdfedit') {
  if (item.kind === 'draft' && item.draftId) await openDraft(item.draftId);
  else if (item.path) await openPath(item.path);
  else return;
  hideHome();
  if (then === 'edit' && doc.mode === 'read' && doc.readKind) await startEditing();
  if (then === 'export') ui.exportOpen = true;
  if (then === 'pdfedit' && doc.readKind === 'pdf') await startPdfEdit();
}

export async function newDocumentHere() {
  const folder = ui.homeSection === 'folder' && ui.homeFolder != null && settings.libraryRoot ? joinPath(settings.libraryRoot, ui.homeFolder) : undefined;
  await newDraft('', folder);
  hideHome();
}

/** Rinomina un file sul disco; note, stato di lettura e recenti lo seguono. */
export async function renameItem(item: HomeItem, typed: string): Promise<boolean> {
  if (!item.path) return false;
  const ext = extname(item.path);
  let base = typed.trim();
  if (base.toLowerCase().endsWith('.' + ext)) base = base.slice(0, -(ext.length + 1));
  base = safeFileName(base);
  if (!base || base === stripExt(basename(item.path))) return false;
  const oldPath = item.path;
  const isOpen = doc.path != null && normPath(doc.path) === normPath(oldPath);
  if (isOpen) await flushDocument();
  let newPath: string;
  try {
    newPath = await backend.renameFile(oldPath, `${base}.${ext}`);
  } catch (e) {
    notify(t('Non è stato possibile rinominare: {message}', { message: (e as Error).message }), 'error');
    return false;
  }
  const oldKey = keyForPath(oldPath);
  const newKey = keyForPath(newPath);
  const newName = basename(newPath);
  rekey(oldKey, newKey, newName, newPath);
  for (const r of session.recent) {
    if (r.path && normPath(r.path) === normPath(oldPath)) Object.assign(r, { key: newKey, name: newName, path: newPath });
  }
  if (session.current?.path && normPath(session.current.path) === normPath(oldPath)) Object.assign(session.current, { key: newKey, name: newName, path: newPath });
  for (const d of Object.values(session.drafts)) {
    if (d.origin && normPath(d.origin.path) === normPath(oldPath)) d.origin.path = newPath;
  }
  save.session();
  if (isOpen) {
    const info = await backend.fileInfo(newPath).catch(() => null);
    Object.assign(doc, { key: newKey, name: newName, path: newPath, modifiedMs: info?.modified_ms ?? doc.modifiedMs });
  }
  forgetThumb(oldPath);
  await scanLibrary({ quiet: true });
  notify(t('Rinominato in {name}.', { name: newName }), 'ok');
  return true;
}

/** Elimina una bozza (con la possibilità di annullare). */
export async function deleteDraft(id: string) {
  const entry = session.drafts[id];
  if (!entry) return;
  if (doc.draftId === id) {
    notify(t('Questa bozza è aperta: apri un altro documento prima di eliminarla.'), 'info');
    return;
  }
  const text = await backend.draftLoad(id).catch(() => null);
  await backend.draftDelete(id).catch(() => {});
  delete session.drafts[id];
  save.session();
  const what = entry.origin
    ? t('Modifiche a «{name}» eliminate.', { name: basename(entry.origin.path) })
    : t('Bozza «{name}» eliminata.', { name: entry.title || t('Senza titolo') });
  notify(what, 'info', {
    label: t('Annulla'),
    run: async () => {
      if (text != null) await backend.draftSave(id, text);
      session.drafts[id] = entry;
      save.session();
    },
  });
}

/** Numero di note per documento. */
export function noteCounts(): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of notesStore.list) m.set(n.docKey, (m.get(n.docKey) ?? 0) + 1);
  return m;
}

/** File con modifiche al testo non ancora salvate in un file. */
export function pendingEdits(): Set<string> {
  const s = new Set<string>();
  for (const d of Object.values(session.drafts)) if (d.origin && !d.origin.targetFormat) s.add(normPath(d.origin.path));
  return s;
}

export function stateCounts(entries: LibraryEntry[]) {
  const c = { unread: 0, reading: 0, read: 0 };
  for (const e of entries) c[readState('lib:' + e.rel)]++;
  return c;
}

export { libraryData };
