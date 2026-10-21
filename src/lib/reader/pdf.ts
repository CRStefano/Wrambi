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
}

function isTextItem(x: unknown): x is TextItem {
  return typeof (x as TextItem).str === 'string';
}

/**
 * Estrae il testo del PDF come Markdown: titoli, elenchi e paragrafi, con un
 * indicatore «[p. N]» all'inizio di ogni pagina.
 */
export async function extractPdfText(pdf: PDFDocumentProxy, onProgress?: (done: number, total: number) => void): Promise<ExtractedPdf> {
  const pages: Para[][] = [];
  let empty = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const paras = pageParagraphs(content.items.filter(isTextItem));
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
  return { title, text: parts.join('\n\n') + '\n', pages: pdf.numPages, emptyPages: empty };
}
