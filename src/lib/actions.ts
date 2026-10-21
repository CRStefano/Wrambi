/**
 * Comandi dell'app, condivisi da barra, menu e scorciatoie.
 */
import { inTauri } from './backend';
import { newDraft, openWithDialog, saveNow, startEditing, writeDerived } from './docs.svelte';
import { editor } from './editor/controller';
import { pdfEdit, startPdfEdit } from './pdfedit/session.svelte';
import { IS_MAC } from './platform';
import { t, tk } from './i18n';
import { hideHome, newDocumentHere, showHome } from './home.svelte';
import { doc, notify, save, setDoNotDisturb, settings, ui } from './state.svelte';

export const FONT_MIN = 13;
export const FONT_MAX = 32;

export async function windowApi() {
  if (!inTauri) return null;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

function pdfEditActive(): boolean {
  return pdfEdit.active;
}

export function closeOverlays() {
  ui.menu = false;
  ui.contextMenu = null;
  ui.popover = null;
  ui.link = null;
  ui.cite = false;
}

export const actions = {
  newDocument: () => {
    if (ui.home) void newDocumentHere();
    else void newDraft();
  },
  openDocument: async () => {
    const before = doc.key;
    await openWithDialog();
    if (ui.home && doc.key !== before) hideHome();
  },
  save: async () => {
    if (doc.mode !== 'edit') {
      notify(t('Le note si salvano da sole. Per cambiare il testo premi «Modifica».'), 'info');
      return;
    }
    if (doc.derived?.targetFormat) {
      await writeDerived(true).catch((e) => notify(t('Salvataggio non riuscito: {message}', { message: (e as Error).message }), 'error'));
      return;
    }
    if (doc.derived || doc.draftId) {
      closeOverlays();
      ui.saveSheet = true;
      return;
    }
    await saveNow({ force: false, announce: true });
  },
  saveAs: () => {
    if (doc.mode !== 'edit') {
      notify(t('Per salvare il testo in un altro file premi prima «Modifica», oppure usa Esporta.'), 'info');
      return;
    }
    closeOverlays();
    ui.saveSheet = true;
  },
  edit: () => void startEditing(),
  toggleLibrary() {
    if (ui.home) hideHome();
    else {
      if (ui.focus) actions.toggleFocus(false);
      showHome();
    }
  },
  toggleNotes() {
    if (ui.home) {
      ui.homeSection = 'notes';
      return;
    }
    ui.notes = !ui.notes;
    if (ui.notes && ui.focus) actions.toggleFocus(false);
  },
  togglePreview() {
    ui.preview = !ui.preview;
    if (ui.preview && ui.focus) actions.toggleFocus(false);
  },
  toggleFocus(on = !ui.focus) {
    ui.focus = on;
    if (on) {
      ui.home = false;
      ui.notes = false;
      ui.preview = false;
      closeOverlays();
    }
    editor.configure({ focusDim: on && settings.focusDim });
    editor.focus();
  },
  async toggleFullscreen() {
    const w = await windowApi();
    if (!w) {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen().catch(() => {});
      ui.fullscreen = !!document.fullscreenElement;
      return;
    }
    const next = !(await w.isFullscreen());
    await w.setFullscreen(next);
    ui.fullscreen = next;
  },
  toggleDnd() {
    setDoNotDisturb(!ui.dnd);
  },
  fontSize(delta: number) {
    settings.fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, settings.fontSize + delta));
    save.settings();
  },
  startNote() {
    const sel = editor.selectionForNote();
    if (!sel) {
      notify(t('Seleziona il testo a cui collegare la nota.'), 'info');
      return;
    }
    if (doc.mode === 'read' && doc.pdfView === 'pages') {
      notify(t('Le note si aggiungono nella vista Testo.'), 'info');
      return;
    }
    const v = editor.view!;
    const start = v.coordsAtPos(sel.from);
    const end = v.coordsAtPos(sel.to) ?? start;
    if (!start || !end) return;
    ui.popover = { noteId: null, draft: sel, ...popoverPlacement(new DOMRect(start.left, start.top, end.right - start.left, end.bottom - start.top)) };
  },
  /** Modifica le pagine del PDF aperto (testo, evidenziazioni, pagine). */
  editPdf: async () => {
    if (doc.readKind !== 'pdf') return;
    closeOverlays();
    await startPdfEdit();
  },
  /** Inserisce una citazione dalla bibliografia (solo nei documenti Markdown). */
  cite: () => {
    if (doc.mode !== 'edit' || doc.format !== 'md') return;
    closeOverlays();
    ui.cite = true;
  },
  openSettings: () => {
    closeOverlays();
    ui.settings = true;
  },
  openExport: () => {
    closeOverlays();
    ui.exportOpen = true;
  },
  openVault: () => {
    closeOverlays();
    ui.vault = true;
  },
  openShortcuts: () => {
    closeOverlays();
    ui.shortcuts = true;
  },
  find: () => {
    if (ui.home) document.getElementById('home-search')?.focus();
    else editor.openSearch();
  },
};

/** Posiziona il riquadro della nota sotto (o sopra) il testo annotato. */
export function popoverPlacement(rect: DOMRect): { x: number; y: number; below: boolean } {
  const width = 360;
  const height = 230;
  const x = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
  const below = rect.bottom + height + 16 < window.innerHeight;
  const y = below ? rect.bottom + 10 : Math.max(12, rect.top - height - 10);
  return { x, y, below };
}

export interface Shortcut {
  keys: string;
  label: string;
  group: string;
}

export const SHORTCUTS: Shortcut[] = [
  { group: tk('Documento'), keys: 'Ctrl+N', label: tk('Nuovo documento') },
  { group: tk('Documento'), keys: 'Ctrl+O', label: tk('Apri…') },
  { group: tk('Documento'), keys: 'Ctrl+S', label: tk('Salva (le bozze e i PDF modificati chiedono dove)') },
  { group: tk('Documento'), keys: 'Ctrl+Shift+S', label: tk('Salva una copia…') },
  { group: tk('Documento'), keys: 'Ctrl+Shift+E', label: tk('Esporta…') },
  { group: tk('Documento'), keys: 'Ctrl+F', label: tk('Cerca e sostituisci') },
  { group: tk('Struttura'), keys: 'Ctrl+0', label: tk('Paragrafo') },
  { group: tk('Struttura'), keys: 'Ctrl+1 … Ctrl+4', label: tk('Titolo di livello 1–4') },
  { group: tk('Struttura'), keys: 'Ctrl+Shift+8', label: tk('Elenco puntato') },
  { group: tk('Struttura'), keys: 'Ctrl+Shift+7', label: tk('Elenco numerato') },
  { group: tk('Struttura'), keys: 'Ctrl+Shift+Q', label: tk('Citazione') },
  { group: tk('Struttura'), keys: 'Ctrl+Alt+C', label: tk('Blocco di codice') },
  { group: tk('Testo'), keys: 'Ctrl+B', label: tk('Grassetto') },
  { group: tk('Testo'), keys: 'Ctrl+I', label: tk('Corsivo') },
  { group: tk('Testo'), keys: 'Ctrl+U', label: tk('Sottolineato') },
  { group: tk('Testo'), keys: 'Ctrl+Shift+X', label: tk('Barrato') },
  { group: tk('Testo'), keys: 'Ctrl+E', label: tk('Codice nel testo') },
  { group: tk('Testo'), keys: 'Ctrl+K', label: tk('Collegamento') },
  { group: tk('Testo'), keys: 'Ctrl+M', label: tk('Nota sul testo selezionato') },
  { group: tk('Testo'), keys: 'Ctrl+Shift+C', label: tk('Cita un\'opera della bibliografia') },
  { group: tk('Vista'), keys: IS_MAC ? '⌃+⌘+F' : 'F11', label: tk('Schermo intero (Esc per uscire)') },
  { group: tk('Vista'), keys: 'Ctrl+Shift+F', label: tk('Focus') },
  { group: tk('Vista'), keys: 'Esc', label: tk('Esci da Focus') },
  { group: tk('Vista'), keys: 'Ctrl+Shift+L', label: tk('Biblioteca (Esc per tornare al documento)') },
  { group: tk('Vista'), keys: 'Ctrl+Shift+N', label: tk('Tutte le note') },
  { group: tk('Vista'), keys: 'Ctrl+Shift+P', label: tk('Anteprima e conversione') },
  { group: tk('Vista'), keys: 'Ctrl+Shift+D', label: tk('Non disturbare') },
  { group: tk('Vista'), keys: 'Ctrl+= / Ctrl+-', label: tk('Ingrandisci o riduci il testo') },
  { group: tk('Vista'), keys: 'Ctrl+,', label: tk('Impostazioni') },
  { group: tk('Vista'), keys: 'Ctrl+/', label: tk('Questo elenco') },
];

/** Scorciatoie globali, intercettate prima dell'editor. */
export function handleGlobalKey(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  // Durante la modifica di un PDF salva, annulla e ripeti sono della modifica.
  if (pdfEditActive() && mod && !e.altKey && (k === 's' || k === 'z' || k === 'y')) return false;
  const run = (fn: () => unknown) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
    return true;
  };
  if (e.key === 'F11') return run(() => actions.toggleFullscreen());
  // Su Mac lo schermo intero è Ctrl+⌘+F.
  if (IS_MAC && e.metaKey && e.ctrlKey && k === 'f') return run(() => actions.toggleFullscreen());
  if (e.key === 'F5' || (mod && k === 'r')) return run(() => {}); // niente ricarica accidentale
  if (e.key === 'Escape') {
    // Il riquadro della nota gestisce da sé Esc, per salvare il testo scritto.
    if (ui.popover && (e.target as HTMLElement | null)?.closest?.('[role=dialog]')) return false;
    // Campi e menu che gestiscono da sé Esc (rinomina, menu delle azioni); la ricerca si svuota.
    const own = (e.target as HTMLElement | null)?.closest?.('[data-own-escape]') as HTMLElement | null;
    if (own instanceof HTMLInputElement && own.type === 'search') {
      if (own.value) {
        e.preventDefault();
        own.value = '';
        own.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    } else if (own) return false;
    if (ui.contextMenu) return run(() => (ui.contextMenu = null));
    if (ui.popover || ui.link || ui.menu || ui.cite) return run(closeOverlays);
    if (document.querySelector('[data-busy="true"]')) return run(() => {});
    if (ui.shortcuts) return run(() => (ui.shortcuts = false));
    if (ui.exportOpen) return run(() => (ui.exportOpen = false));
    if (ui.saveSheet) return run(() => (ui.saveSheet = false));
    if (ui.vault) return run(() => (ui.vault = false));
    if (ui.settings) return run(() => (ui.settings = false));
    if (ui.focus) return run(() => actions.toggleFocus(false));
    if (ui.fullscreen) return run(() => actions.toggleFullscreen());
    if (ui.home) return run(hideHome);
    return false;
  }
  if (!mod || e.altKey) return false;
  if (e.shiftKey) {
    switch (k) {
      case 's':
        return run(actions.saveAs);
      case 'e':
        return run(actions.openExport);
      case 'l':
        return run(actions.toggleLibrary);
      case 'n':
        return run(actions.toggleNotes);
      case 'p':
        return run(actions.togglePreview);
      case 'f':
        return run(() => actions.toggleFocus());
      case 'd':
        return run(actions.toggleDnd);
    }
    return false;
  }
  switch (k) {
    case 'n':
      return run(actions.newDocument);
    case 'o':
      return run(actions.openDocument);
    case 's':
      return run(actions.save);
    case 'p':
      return run(actions.openExport); // invece della stampa del browser
    case ',':
      return run(actions.openSettings);
    case '/':
      return run(actions.openShortcuts);
    case '=':
    case '+':
      return run(() => actions.fontSize(1));
    case '-':
      return run(() => actions.fontSize(-1));
    case 'm':
      if (ui.home) return false;
      if (!editor.view?.hasFocus) return run(actions.startNote);
      return false;
    case 'f':
      if (ui.home) return run(actions.find);
      return false;
  }
  return false;
}
