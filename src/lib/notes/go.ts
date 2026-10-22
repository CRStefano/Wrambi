/**
 * Apre il documento di una nota e la mostra nel testo, con il riquadro aperto.
 */
import { popoverPlacement } from '../actions';
import { openNoteContext } from '../docs.svelte';
import { editor } from '../editor/controller';
import { doc, ui, type Note } from '../state.svelte';
import { pagesAvailable, revealNoteOnPages } from '../reader/sync.svelte';
import { tick } from 'svelte';

export async function goToNote(n: Note): Promise<boolean> {
  const ok = await openNoteContext(n);
  if (!ok) return false;
  ui.home = false;
  if (n.orphan) {
    ui.popover = { noteId: n.id, x: window.innerWidth / 2 - 180, y: 120, below: true };
    return true;
  }
  if (doc.pdfView === 'pages' && pagesAvailable()) {
    // Vista a pagine: la nota si mostra sulla pagina.
    await tick();
    if (revealNoteOnPages(n.id)) {
      setTimeout(() => {
        const el = document.querySelector<HTMLElement>(`.pdf-page .pdf-mark[data-id="${CSS.escape(n.id)}"]`);
        if (el) ui.popover = { noteId: n.id, ...popoverPlacement(el.getBoundingClientRect()) };
      }, 650);
      return true;
    }
  }
  requestAnimationFrame(() => {
    editor.view?.requestMeasure();
    const rect = editor.revealNote(n.id);
    if (rect) setTimeout(() => (ui.popover = { noteId: n.id, ...popoverPlacement(editor.revealNote(n.id) ?? rect) }), 120);
  });
  return true;
}
