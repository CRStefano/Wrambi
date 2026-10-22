/**
 * Esportazione del documento aperto nei formati supportati.
 */
import { backend, basename, dirname, joinPath, safeFileName } from './backend';
import { refreshBibliography } from './biblio/store.svelte';
import { converter, type ConvertRequest } from './convert/client';
import { FORMATS, type OutFormat } from './convert';
import { bibFileFor } from './convert/emit';
import { insertNoteMarks } from './convert/notes';
import { displayName, isPlainText, notesFor } from './docs.svelte';
import { editor } from './editor/controller';
import { doc, settings } from './state.svelte';
import { t } from './i18n';

/** Nome del file .bib che il PDF compilato dentro Wrambi trova in memoria. */
export const VIRTUAL_BIB = 'wrambi-citazioni.bib';

/** Il documento si converte (non è un sorgente Typst, LaTeX o HTML da copiare). */
export function isConvertible(): boolean {
  return !(doc.mode === 'edit' && (doc.format === 'typ' || doc.format === 'tex' || doc.format === 'html'));
}

/** Note del documento aperto che si possono esportare come note a piè di pagina. */
export function exportableNotes() {
  if (!doc.key) return [];
  // Le evidenziazioni non diventano note a piè di pagina.
  return notesFor(doc.key).filter((n) => !n.orphan && n.text.trim() && n.kind !== 'highlight');
}

/** Testo da convertire e opzioni comuni: lingua, note di Wrambi, citazioni. */
export async function conversionInput(withNotes = settings.exportNotes): Promise<{ text: string; opts: ConvertRequest }> {
  await refreshBibliography();
  let text = editor.getText();
  const opts: ConvertRequest = {
    plain: isPlainText(),
    title: doc.title || displayName(doc.name),
    lang: settings.docLanguage,
    cite: true,
  };
  if (withNotes) {
    // Le posizioni vive dell'editor, se ci sono; altrimenti quelle salvate.
    const live = new Map(editor.noteRanges().map((r) => [r.id, r]));
    const ranges = exportableNotes().map((n) => ({ from: live.get(n.id)?.from ?? n.from, to: live.get(n.id)?.to ?? n.to, text: n.text }));
    if (ranges.length) {
      const r = insertNoteMarks(text, ranges);
      text = r.src;
      opts.notes = r.notes;
    }
  }
  return { text, opts };
}

export interface ExportChoice {
  id: OutFormat;
  label: string;
  ext: string;
  fidelity: string;
  available: boolean;
  reason?: string;
}

/** Formati disponibili per il documento aperto, con il motivo di ogni limite (nella lingua dell'interfaccia). */
export function exportChoices(): ExportChoice[] {
  return FORMATS.map((f) => {
    const base: ExportChoice = { ...f, label: t(f.label), fidelity: t(f.fidelity), available: true };
    if (doc.mode === 'read') {
      const fidelity = base.fidelity.charAt(0).toLowerCase() + base.fidelity.slice(1);
      base.fidelity = t('Dal testo estratto ({kind}): {fidelity} L\'impaginazione del file originale non viene conservata.', {
        kind: doc.readKind?.toUpperCase() ?? '',
        fidelity,
      });
      return base;
    }
    if (doc.format === 'typ') {
      if (f.id === 'pdf') return { ...base, fidelity: t('Compilato con il Typst integrato: è il risultato esatto del sorgente.') };
      if (f.id === 'typ') return { ...base, fidelity: t('Copia del sorgente Typst.') };
      return {
        ...base,
        available: false,
        reason: t('Wrambi non converte il codice Typst in altri formati senza perdere informazioni. Esporta in PDF oppure il sorgente .typ.'),
      };
    }
    if (doc.format === 'tex') {
      if (f.id === 'tex') return { ...base, fidelity: t('Copia del sorgente LaTeX.') };
      return {
        ...base,
        available: false,
        reason: t('Wrambi non include un motore LaTeX e non converte il codice LaTeX in altri formati. Compila il .tex con la tua installazione di LaTeX.'),
      };
    }
    if (doc.format === 'html') {
      if (f.id === 'html') return { ...base, fidelity: t('Copia del sorgente HTML.') };
      return { ...base, available: false, reason: t('Per convertire una pagina HTML aprila in lettura dalla biblioteca, poi esporta il testo.') };
    }
    if (doc.format === 'txt' && f.id === 'md') {
      return { ...base, fidelity: t('Il testo con i caratteri speciali protetti: in Markdown si vede identico all\'originale.') };
    }
    return base;
  });
}

export function suggestedName(ext: string): string {
  const title = doc.title || displayName(doc.name) || t('Documento');
  return safeFileName(title) + '.' + ext;
}

export function defaultExportDir(): string | null {
  return settings.exportDir ?? (doc.path ? dirname(doc.path) : settings.libraryRoot);
}

export interface ExportResult {
  path: string;
  /** File .bib scritto accanto (sorgenti Typst e LaTeX con citazioni). */
  bib?: string;
}

/** Esporta il documento aperto. `notes: false` per riscrivere un file senza note a piè di pagina. */
export async function exportTo(format: OutFormat, dest: string, o: { notes?: boolean } = {}): Promise<ExportResult> {
  const root = doc.path ? dirname(doc.path) : null;

  if (!isConvertible()) {
    const text = editor.getText();
    if (format === 'pdf' && doc.format === 'typ') {
      const res = await backend.typstExportPdf(text, root, dest, settings.systemFonts, null);
      if (!res.ok) throw new Error(firstError(res.diagnostics));
      return { path: dest };
    }
    await backend.writeText(dest, text);
    return { path: dest };
  }

  const { text, opts } = await conversionInput(o.notes ?? settings.exportNotes);
  switch (format) {
    case 'pdf': {
      const r = await converter.convert(text, 'typ', { ...opts, bibFile: VIRTUAL_BIB });
      const res = await backend.typstExportPdf(r.text, root, dest, settings.systemFonts, r.bib);
      if (!res.ok) throw new Error(firstError(res.diagnostics));
      return { path: dest };
    }
    case 'epub': {
      const bytes = await converter.epub(text, opts.title ?? '', opts);
      await backend.writeBinary(dest, bytes);
      return { path: dest };
    }
    case 'md':
      if (!opts.plain && !opts.notes) await backend.writeText(dest, text);
      else await backend.writeText(dest, (await converter.convert(text, 'md', opts)).text);
      return { path: dest };
    case 'typ':
    case 'tex': {
      const bibName = bibFileFor(basename(dest));
      const r = await converter.convert(text, format, { ...opts, bibFile: bibName });
      await backend.writeText(dest, r.text);
      if (!r.bib) return { path: dest };
      const bibPath = joinPath(dirname(dest), bibName);
      await backend.writeText(bibPath, r.bib);
      return { path: dest, bib: bibPath };
    }
    default:
      await backend.writeText(dest, (await converter.convert(text, format, opts)).text);
      return { path: dest };
  }
}

export function firstError(diags: { error: boolean; message: string; line: number | null }[]): string {
  const e = diags.find((d) => d.error);
  if (!e) return t('compilazione non riuscita');
  return e.line ? t('riga {line}: {message}', { line: e.line, message: e.message }) : e.message;
}

export function exportPathFor(dir: string, name: string): string {
  return joinPath(dir, basename(name));
}
