/**
 * Stato della modifica di un PDF: pagine, modifiche, strumento scelto,
 * annulla/ripeti e salvataggio.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { backend, basename, dialogs, dirname, extname, stripExt } from '../backend';
import { copyNotesToFile, openPath, reader } from '../docs.svelte';
import { t, tn } from '../i18n';
import { closePdfDocument, openPdf } from '../reader/pdf';
import { doc, leaveGuard, notify } from '../state.svelte';
import { buildPdf, PdfEditError, type FontSpec, type ImageData, type Op, type PageRef, type RGB } from './model';

export type Tool = 'select' | 'edit' | 'text' | 'highlight' | 'cover' | 'image' | 'note';

interface Snapshot {
  pages: PageRef[];
  ops: Op[];
}

export const pdfEdit = $state({
  active: false,
  path: '' as string,
  pages: [] as PageRef[],
  ops: [] as Op[],
  tool: 'edit' as Tool,
  selected: null as string | null,
  /** Pagina da mostrare (scorrimento dalle miniature). */
  focusPage: null as string | null,
  dirty: false,
  saving: false,
  font: { family: 'sans', bold: false, italic: false } as FontSpec,
  size: 12,
  color: [0, 0, 0] as RGB,
  highlight: [1, 0.86, 0.2] as RGB,
  zoom: 1,
  canUndo: false,
  canRedo: false,
});

let original: Uint8Array | null = null;
/** PDF aggiunti: byte (per il salvataggio) e documento pdf.js (per disegnarli). */
const extra: { bytes: Uint8Array; pdf: PDFDocumentProxy; name: string }[] = [];
export const images = new Map<string, ImageData & { url: string }>();
let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];
let seq = 0;

export const newId = () => `e${Date.now().toString(36)}${(++seq).toString(36)}`;

function snapshot(): Snapshot {
  return $state.snapshot({ pages: pdfEdit.pages, ops: pdfEdit.ops }) as Snapshot;
}

/** Da chiamare prima di ogni modifica: la rende annullabile. */
export function checkpoint() {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
  pdfEdit.dirty = true;
  sync();
}

function sync() {
  pdfEdit.canUndo = undoStack.length > 0;
  pdfEdit.canRedo = redoStack.length > 0;
}

export function undo() {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(snapshot());
  pdfEdit.pages = s.pages;
  pdfEdit.ops = s.ops;
  pdfEdit.selected = null;
  sync();
}

export function redo() {
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(snapshot());
  pdfEdit.pages = s.pages;
  pdfEdit.ops = s.ops;
  pdfEdit.selected = null;
  sync();
}

/** Documento pdf.js da cui disegnare una pagina. */
export function sourcePdf(src: number): PDFDocumentProxy | null {
  if (src === 0) return reader.pdf;
  return extra[src - 1]?.pdf ?? null;
}

export async function startPdfEdit(): Promise<void> {
  if (!doc.path || doc.readKind !== 'pdf' || !reader.pdf) return;
  try {
    original = await backend.readBinary(doc.path);
  } catch (e) {
    notify(t('Il PDF non si legge: {message}', { message: (e as Error).message }), 'error');
    return;
  }
  const n = reader.pdf.numPages;
  Object.assign(pdfEdit, {
    active: true,
    path: doc.path,
    pages: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, src: 0, index: i, rotate: 0 })),
    ops: [],
    tool: 'edit',
    selected: null,
    focusPage: null,
    dirty: false,
    saving: false,
    zoom: 1,
  });
  undoStack = [];
  redoStack = [];
  sync();
  leaveGuard.fn = () => closePdfEdit();
}

function release() {
  for (const e of extra.splice(0)) closePdfDocument(e.pdf);
  for (const img of images.values()) URL.revokeObjectURL(img.url);
  images.clear();
  original = null;
  undoStack = [];
  redoStack = [];
}

/** Esce dalla modifica; se ci sono modifiche non salvate chiede conferma. */
export async function closePdfEdit(force = false): Promise<boolean> {
  if (!force && pdfEdit.dirty) {
    const ok = await dialogs.ask(t('Le modifiche al PDF non sono state salvate. Vuoi abbandonarle?'), t('Abbandona'), t('Continua a modificare'));
    if (!ok) return false;
  }
  release();
  leaveGuard.fn = null;
  Object.assign(pdfEdit, { active: false, pages: [], ops: [], selected: null, dirty: false });
  sync();
  return true;
}

/* ───────────────────────────── Pagine ───────────────────────────── */

export function rotatePage(id: string, delta: number) {
  checkpoint();
  const p = pdfEdit.pages.find((x) => x.id === id);
  if (p) p.rotate = (((p.rotate + delta) % 360) + 360) % 360;
}

export function movePage(id: string, delta: number) {
  const i = pdfEdit.pages.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= pdfEdit.pages.length) return;
  checkpoint();
  const [p] = pdfEdit.pages.splice(i, 1);
  pdfEdit.pages.splice(j, 0, p);
}

export function deletePage(id: string) {
  if (pdfEdit.pages.length <= 1) {
    notify(t('Un PDF deve avere almeno una pagina.'), 'info');
    return;
  }
  checkpoint();
  pdfEdit.pages = pdfEdit.pages.filter((x) => x.id !== id);
  pdfEdit.ops = pdfEdit.ops.filter((o) => o.page !== id);
}

/** Inserisce una pagina vuota dopo quella indicata, delle stesse dimensioni. */
export async function insertBlankAfter(id: string) {
  const i = pdfEdit.pages.findIndex((x) => x.id === id);
  const ref = pdfEdit.pages[i];
  let size: [number, number] = [595.28, 841.89];
  if (ref?.size) size = ref.size;
  else if (ref) {
    const pdf = sourcePdf(ref.src);
    if (pdf) {
      const page = await pdf.getPage(ref.index + 1);
      const [x0, y0, x1, y1] = page.view;
      size = [x1 - x0, y1 - y0];
    }
  }
  checkpoint();
  pdfEdit.pages.splice(i + 1, 0, { id: newId(), src: -1, index: 0, rotate: 0, size });
}

/** Aggiunge in fondo le pagine di un altro PDF. */
export async function appendPdf() {
  const path = await dialogs.pickFile(t('Aggiungi le pagine di un PDF'), [{ name: 'PDF', extensions: ['pdf'] }], dirname(pdfEdit.path));
  if (!path) return;
  try {
    const bytes = await backend.readBinary(path);
    const pdf = await openPdf(bytes);
    extra.push({ bytes, pdf, name: basename(path) });
    const src = extra.length;
    checkpoint();
    for (let i = 0; i < pdf.numPages; i++) pdfEdit.pages.push({ id: newId(), src, index: i, rotate: 0 });
    notify(tn(pdf.numPages, 'Aggiunta una pagina da {name}.', 'Aggiunte {n} pagine da {name}.', { name: basename(path) }), 'ok');
  } catch (e) {
    notify(t('Il PDF non si apre: {message}', { message: (e as Error).message }), 'error');
  }
}

/* ───────────────────────────── Modifiche ───────────────────────────── */

export function addOp(op: Op) {
  checkpoint();
  pdfEdit.ops.push(op);
  pdfEdit.selected = op.id;
}

export function updateOp(id: string, patch: Partial<Op>, undoable = true) {
  const op = pdfEdit.ops.find((o) => o.id === id);
  if (!op) return;
  if (undoable) checkpoint();
  Object.assign(op, patch);
  pdfEdit.dirty = true;
}

export function removeOp(id: string) {
  if (!pdfEdit.ops.some((o) => o.id === id)) return;
  checkpoint();
  pdfEdit.ops = pdfEdit.ops.filter((o) => o.id !== id);
  if (pdfEdit.selected === id) pdfEdit.selected = null;
}

/** Riquadro e rotazione con cui la pagina appare sullo schermo. */
export async function pageGeometry(ref: PageRef): Promise<{ viewBox: [number, number, number, number]; rotation: number }> {
  const pdf = ref.src >= 0 ? sourcePdf(ref.src) : null;
  if (!pdf) return { viewBox: [0, 0, ref.size?.[0] ?? 595, ref.size?.[1] ?? 842], rotation: ref.rotate };
  const page = await pdf.getPage(ref.index + 1);
  return { viewBox: page.view as [number, number, number, number], rotation: (page.rotate + ref.rotate) % 360 };
}

/** Legge un'immagine PNG o JPEG e ne ricava tipo e dimensioni. */
export async function loadImage(bytes: Uint8Array): Promise<string> {
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!png && !jpg) throw new Error(t('Sono supportate solo immagini PNG e JPEG.'));
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: png ? 'image/png' : 'image/jpeg' });
  const bmp = await createImageBitmap(blob);
  const id = newId();
  images.set(id, { bytes, type: png ? 'png' : 'jpg', width: bmp.width, height: bmp.height, url: URL.createObjectURL(blob) });
  bmp.close();
  return id;
}

/* ───────────────────────────── Salvataggio ───────────────────────────── */

async function fallbackFonts(): Promise<[Uint8Array, Uint8Array, Uint8Array, Uint8Array]> {
  const get = async (n: string) => new Uint8Array(await (await fetch(`/pdfjs/standard_fonts/LiberationSans-${n}.ttf`)).arrayBuffer());
  return Promise.all([get('Regular'), get('Bold'), get('Italic'), get('BoldItalic')]) as Promise<[Uint8Array, Uint8Array, Uint8Array, Uint8Array]>;
}

async function build(): Promise<Uint8Array> {
  if (!original) throw new Error(t('Il PDF originale non è più disponibile.'));
  try {
    return await buildPdf({
      original,
      extra: extra.map((e) => e.bytes),
      pages: $state.snapshot(pdfEdit.pages) as PageRef[],
      ops: $state.snapshot(pdfEdit.ops) as Op[],
      images,
      fallbackFonts,
    });
  } catch (e) {
    if (e instanceof PdfEditError && e.message === 'encrypted') {
      throw new Error(t('Il PDF è cifrato o protetto: Wrambi non può modificarlo.'));
    }
    throw e;
  }
}

/** Salva una copia accanto all'originale («nome_modificato.pdf») e la apre. */
export async function saveCopy(): Promise<void> {
  if (pdfEdit.saving) return;
  pdfEdit.saving = true;
  try {
    const bytes = await build();
    const name = `${stripExt(basename(pdfEdit.path))}_${t('modificato')}.${extname(pdfEdit.path) || 'pdf'}`;
    const dest = await backend.freePath(dirname(pdfEdit.path), name);
    await backend.writeBinary(dest, bytes);
    // La copia porta con sé le note dell'originale.
    copyNotesToFile(doc.key, dest);
    await closePdfEdit(true);
    notify(t('Salvato: {name}', { name: basename(dest) }), 'ok');
    await openPath(dest);
    doc.pdfView = 'pages';
  } catch (e) {
    notify(t('Salvataggio non riuscito: {message}', { message: (e as Error).message }), 'error');
  } finally {
    pdfEdit.saving = false;
  }
}

/** Sovrascrive l'originale, dopo averne fatto una copia di sicurezza accanto. */
export async function saveOver(): Promise<void> {
  if (pdfEdit.saving) return;
  const ok = await dialogs.ask(
    t('Il PDF originale sarà sostituito dalla versione modificata. Accanto resta una copia di sicurezza «{name}».', {
      name: `${stripExt(basename(pdfEdit.path))} (${t('originale')}).pdf`,
    }),
    t('Sostituisci'),
  );
  if (!ok) return;
  pdfEdit.saving = true;
  try {
    const bytes = await build();
    await backend.copyBeside(pdfEdit.path, t('originale'));
    await backend.writeBinary(pdfEdit.path, bytes);
    const path = pdfEdit.path;
    await closePdfEdit(true);
    notify(t('PDF aggiornato. La versione precedente è accanto, con «({suffix})» nel nome.', { suffix: t('originale') }), 'ok');
    await openPath(path);
    doc.pdfView = 'pages';
  } catch (e) {
    notify(t('Salvataggio non riuscito: {message}', { message: (e as Error).message }), 'error');
  } finally {
    pdfEdit.saving = false;
  }
}
