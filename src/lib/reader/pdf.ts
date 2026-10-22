/**
 * PDF con pdf.js: pagine disegnate così come sono (impaginazione originale)
 * e testo estratto per leggere, cercare e annotare.
 *
 * Il testo estratto è ricostruito dalle posizioni dei caratteri: colonne,
 * note a piè di pagina e formule possono uscire in un ordine imperfetto.
 * I PDF scansionati (solo immagini) non hanno testo da estrarre.
 */
// Build "legacy": include i polyfill, così funziona anche con runtime WebView2 meno recenti.
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { bodySize, pageParagraphs, pageToMarkdown, type Para } from './pdftext';
import { buildIndex, pageText, type PageItem, type PageText, type PdfIndex } from './textmap';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { t } from '../i18n';

GlobalWorkerOptions.workerSrc = workerUrl;

const ASSETS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  wasmUrl: '/pdfjs/wasm/',
};

/** Libera la memoria e il worker di un PDF. */
export function closePdfDocument(pdf: PDFDocumentProxy | null) {
  if (pdf) void pdf.loadingTask.destroy();
}

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js trasferisce il buffer al worker: gli passiamo una copia.
  const task = getDocument({ data: bytes.slice(), ...ASSETS });
  try {
    return await task.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException') throw new Error(t('Il PDF è protetto da password: Wrambi non può aprirlo.'));
    if (name === 'InvalidPDFException') throw new Error(t('Il file non è un PDF valido o è danneggiato.'));
    throw new Error(t('PDF illeggibile: {message}', { message: String((e as Error)?.message ?? e) }));
  }
}

export interface ExtractedPdf {
  title: string;
  text: string;
  pages: number;
  /** Pagine senza testo (probabilmente scansioni). */
  emptyPages: number;
  /** Testo delle pagine, per ritrovare sulle pagine i punti del testo. */
  index: PdfIndex;
}

export function isTextItem(x: unknown): x is TextItem {
  return typeof (x as TextItem).str === 'string';
}

type PageLike = { getViewport(o: { scale: number }): { height: number; convertToViewportPoint(x: number, y: number): number[] } };

/** Frammenti di testo di una pagina con la loro altezza sulla pagina (0 in alto, 1 in basso). */
export function pageItems(page: PageLike, items: TextItem[]): PageItem[] {
  const vp = page.getViewport({ scale: 1 });
  return items.map((it) => {
    const h = Math.abs(it.height) || Math.hypot(it.transform[2], it.transform[3]) || 10;
    const [, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5] + h);
    return { str: it.str, top: Math.min(1, Math.max(0, y / vp.height)) };
  });
}

/** Indice del testo delle pagine di un PDF (per le corrispondenze con il testo). */
export async function buildPdfIndex(pdf: PDFDocumentProxy, alive: () => boolean = () => true): Promise<PdfIndex | null> {
  const pages: PageText[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    if (!alive()) return null;
    try {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      pages.push(pageText(pageItems(page, content.items.filter(isTextItem))));
    } catch {
      if (!alive()) return null;
      pages.push(pageText([]));
    }
    if (n % 8 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return buildIndex(pages);
}

/**
 * Estrae il testo del PDF come Markdown: titoli, elenchi e paragrafi, con un
 * indicatore «[p. N]» all'inizio di ogni pagina.
 */
export async function extractPdfText(pdf: PDFDocumentProxy, onProgress?: (done: number, total: number) => void): Promise<ExtractedPdf> {
  const pages: Para[][] = [];
  const texts: PageText[] = [];
  let empty = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const items = content.items.filter(isTextItem);
    const paras = pageParagraphs(items);
    texts.push(pageText(pageItems(page, items)));
    if (!paras.length) empty++;
    pages.push(paras);
    page.cleanup();
    onProgress?.(n, pdf.numPages);
    // Lascia respirare l'interfaccia sui documenti lunghi.
    if (n % 8 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  // Il corpo del testo si calcola su tutto il documento, così i titoli si riconoscono pagina per pagina.
  const body = bodySize(pages);
  const parts = pages.map((paras, i) => `[p. ${i + 1}]\n\n${pageToMarkdown(paras, body) || t('(pagina senza testo estraibile)')}`);
  let title = '';
  try {
    const meta = await pdf.getMetadata();
    title = ((meta.info as Record<string, unknown>)?.Title as string | undefined)?.trim() ?? '';
  } catch {
    /* metadati assenti */
  }
  return { title, text: parts.join('\n\n') + '\n', pages: pdf.numPages, emptyPages: empty, index: buildIndex(texts) };
}
