/**
 * Gestione delle note dalle liste e dal testo: menu del tasto destro,
 * eliminazione, note di documenti che non esistono più.
 */
import { popoverPlacement } from '../actions';
import { backend, dialogs, joinPath } from '../backend';
import { deleteNotes, displayName, setNoteKind } from '../docs.svelte';
import { editor } from '../editor/controller';
import { goToNote } from './go';
import { t, tn } from '../i18n';
import { notesStore, session, settings, ui, type MenuItem, type Note } from '../state.svelte';

/** Percorso del documento di una nota, se è un file. */
export function notePath(n: Pick<Note, 'docKey' | 'docPath'>): string | null {
  if (n.docKey.startsWith('lib:') && settings.libraryRoot) return joinPath(settings.libraryRoot, n.docKey.slice(4));
  if (n.docKey.startsWith('draft:')) return null;
  return n.docPath ?? (n.docKey.startsWith('file:') ? n.docKey.slice(5) : null);
}

/** Il documento della nota esiste ancora? (bozza conservata o file sul disco) */
export async function documentExists(n: Pick<Note, 'docKey' | 'docPath'>): Promise<boolean> {
  if (n.docKey.startsWith('draft:')) return !!session.drafts[n.docKey.slice(6)];
  const path = notePath(n);
  if (!path) return false;
  const info = await backend.fileInfo(path).catch(() => null);
  return !!info?.exists;
}

export function openMenuAt(x: number, y: number, items: MenuItem[]) {
  ui.popover = null;
  ui.contextMenu = { x, y, items };
}

/** Menu del tasto destro su una nota in un elenco (pannello Note, Biblioteca). */
export function noteMenu(e: MouseEvent, n: Note) {
  e.preventDefault();
  e.stopPropagation();
  openMenuAt(e.clientX, e.clientY, [
    { label: t('Apri la nota'), icon: 'open', run: () => goToNote(n) },
    { label: t('Elimina la nota'), icon: 'delete', danger: true, separatorBefore: true, run: () => deleteNotes([n.id]) },
  ]);
}

/**
 * Menu del tasto destro su una nota o un'evidenziazione nel testo (o sulle
 * pagine del PDF: allora `at` è il rettangolo del segno sulla pagina).
 */
export function editorNoteMenu(id: string, x: number, y: number, at?: DOMRect) {
  const open = () => {
    const rect = at ?? editor.revealNote(id);
    if (rect) ui.popover = { noteId: id, ...popoverPlacement(rect) };
  };
  const n = notesStore.list.find((x) => x.id === id);
  if (n?.kind === 'highlight') {
    openMenuAt(x, y, [
      { label: n.text ? t('Modifica il commento') : t('Aggiungi un commento'), icon: 'edit', run: open },
      { label: t('Trasforma in nota'), icon: 'note', run: () => setNoteKind(id, 'note') },
      { label: t('Elimina l\'evidenziazione'), icon: 'delete', danger: true, separatorBefore: true, run: () => deleteNotes([id]) },
    ]);
    return;
  }
  openMenuAt(x, y, [
    { label: t('Modifica la nota'), icon: 'edit', run: open },
    { label: t('Elimina la nota'), icon: 'delete', danger: true, separatorBefore: true, run: () => deleteNotes([id]) },
  ]);
}

/** Elimina tutte le note di un documento, dopo una conferma. */
export async function deleteDocumentNotes(notes: Note[]) {
  if (!notes.length) return;
  const name = displayName(notes[0].docName);
  const msg = tn(notes.length, 'Eliminare la nota di «{name}»? Potrai annullare subito dopo.', 'Eliminare le {n} note di «{name}»? Potrai annullare subito dopo.', { name });
  if (!(await dialogs.ask(msg, t('Elimina')))) return;
  deleteNotes(notes.map((n) => n.id));
}

/** Elimina le note dei documenti che non esistono più, dopo una conferma. */
export async function deleteOrphanedDocNotes(notes: Note[]) {
  if (!notes.length) return;
  const docs = new Set(notes.map((n) => n.docKey)).size;
  const msg =
    docs === 1
      ? tn(notes.length, 'Eliminare la nota di un documento che non esiste più? Potrai annullare subito dopo.', 'Eliminare le {n} note di un documento che non esiste più? Potrai annullare subito dopo.')
      : t('Eliminare le {n} note di {docs} documenti che non esistono più? Potrai annullare subito dopo.', { n: notes.length, docs });
  if (!(await dialogs.ask(msg, t('Elimina')))) return;
  deleteNotes(notes.map((n) => n.id));
}
