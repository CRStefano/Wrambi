/**
 * Vault cifrato: raccolta dei dati da esportare e unione dei dati importati.
 */
import { t } from './i18n';
import { backend, basename, joinPath, relativeTo, type VaultFileIn, type VaultImport } from './backend';
import { flushDocument, keyForPath } from './docs.svelte';
import { setLibraryRoot } from './library.svelte';
import {
  DEFAULT_SETTINGS,
  flushPersistence,
  libraryData,
  notesStore,
  rekey,
  save,
  session,
  settings,
  ui,
  type LibraryData,
  type Note,
  type Settings,
} from './state.svelte';

export interface VaultPlan {
  files: VaultFileIn[];
  drafts: number;
  noted: number;
  library: number;
  missing: string[];
}

/** Elenca cosa entrerebbe nel vault. */
export async function planVault(opts: { notedDocs: boolean; wholeLibrary: boolean }): Promise<VaultPlan> {
  await flushDocument();
  const files = new Map<string, VaultFileIn>();
  const missing: string[] = [];
  let drafts = 0;
  let noted = 0;
  let library = 0;

  for (const [id, d] of Object.entries(session.drafts)) {
    const text = await backend.draftLoad(id).catch(() => null);
    if (text == null) continue;
    files.set('draft:' + id, { key: 'draft:' + id, name: (d.title || t('Senza titolo')) + '.md', text });
    drafts++;
  }

  if (opts.notedDocs) {
    const keys = new Set(notesStore.list.map((n) => n.docKey).filter((k) => !k.startsWith('draft:')));
    for (const key of keys) {
      const note = notesStore.list.find((n) => n.docKey === key)!;
      const path = key.startsWith('lib:') && settings.libraryRoot ? joinPath(settings.libraryRoot, key.slice(4)) : note.docPath;
      if (!path) {
        missing.push(note.docName);
        continue;
      }
      const info = await backend.fileInfo(path).catch(() => null);
      if (!info?.exists) {
        missing.push(note.docName);
        continue;
      }
      files.set(key, { key, name: basename(path), path });
      noted++;
    }
  }

  if (opts.wholeLibrary) {
    for (const e of ui.libraryEntries) {
      const key = 'lib:' + e.rel;
      if (!files.has(key)) {
        files.set(key, { key, name: e.name, path: e.path });
        library++;
      }
    }
  }
  return { files: [...files.values()], drafts, noted, library, missing };
}

export async function exportVault(dest: string, password: string, plan: VaultPlan) {
  await flushPersistence();
  const data = {
    settings: JSON.stringify($state.snapshot(settings)),
    library: JSON.stringify($state.snapshot(libraryData)),
    notes: JSON.stringify($state.snapshot(notesStore.list)),
  };
  return backend.vaultExport(dest, password, data, plan.files);
}

export interface ImportSummary {
  notes: number;
  documents: number;
  drafts: number;
  usedAsLibrary: boolean;
}

/** Apre un vault e unisce i suoi dati a quelli presenti. */
export async function importVault(src: string, password: string, restoreDir: string, useAsLibrary: boolean): Promise<ImportSummary> {
  await flushDocument();
  await backend.ensureDir(restoreDir);
  const res: VaultImport = await backend.vaultImport(src, password, restoreDir);

  // Impostazioni di aspetto e scrittura; le cartelle restano quelle di questo computer.
  const incoming = safeParse<Partial<Settings>>(res.data.settings);
  if (incoming) {
    const keep = { libraryRoot: settings.libraryRoot, exportDir: settings.exportDir, firstRunDone: true };
    Object.assign(settings, { ...DEFAULT_SETTINGS, ...settings, ...incoming, ...keep });
    save.settings();
  }

  const lib = safeParse<LibraryData>(res.data.library);
  if (lib) {
    Object.assign(libraryData.states, lib.states ?? {});
    Object.assign(libraryData.positions, lib.positions ?? {});
    save.library();
  }

  const notes = safeParse<Note[]>(res.data.notes) ?? [];
  for (const n of notes) {
    const i = notesStore.list.findIndex((x) => x.id === n.id);
    if (i >= 0) notesStore.list[i] = n;
    else notesStore.list.push(n);
  }
  save.notes();

  if (useAsLibrary) await setLibraryRoot(restoreDir);

  let documents = 0;
  let drafts = 0;
  for (const r of res.restored) {
    if (r.text != null && r.key.startsWith('draft:')) {
      const id = r.key.slice(6);
      await backend.draftSave(id, r.text);
      session.drafts[id] = { title: r.name.replace(/\.md$/, ''), updated: Date.now() };
      drafts++;
      continue;
    }
    if (!r.new_path) continue;
    documents++;
    // Le note seguono il documento nella nuova posizione.
    const newKey = keyForPath(r.new_path);
    if (newKey !== r.key) rekey(r.key, newKey, basename(r.new_path), relativeTo(settings.libraryRoot, r.new_path) ? null : r.new_path);
    else for (const n of notesStore.list) if (n.docKey === newKey && !n.docKey.startsWith('lib:')) n.docPath = r.new_path;
  }
  save.session();
  save.notes();
  return { notes: notes.length, documents, drafts, usedAsLibrary: useAsLibrary };
}

function safeParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
