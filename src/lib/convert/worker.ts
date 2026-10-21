/// <reference lib="webworker" />
/**
 * Worker di conversione: analisi del testo e generazione dei formati
 * avvengono qui, fuori dal thread dell'interfaccia. Il worker tiene anche la
 * bibliografia, così non viene ricopiata a ogni conversione.
 */
import { analyze, convertDocument, type TextualFormat } from './index';
import { buildEpub } from './epub';
import { parse } from './ast';
import { parsePlain } from './plain';
import { BibIndex } from '../biblio/format';
import type { BibEntry } from '../biblio/model';

/** Opzioni comuni delle conversioni. */
export interface ConvertRequest {
  plain: boolean;
  title?: string;
  /** Lingua del documento. */
  lang?: string;
  /** Testi delle note esportate (i segnaposto sono già nel testo). */
  notes?: string[];
  /** Usa la bibliografia caricata per le citazioni. */
  cite?: boolean;
  /** Nome del file .bib a cui rimanda il sorgente (Typst, LaTeX). */
  bibFile?: string;
}

export type Request =
  | { id: number; kind: 'bibliography'; entries: BibEntry[] | null }
  | { id: number; kind: 'analyze'; text: string; fallback: string; plain: boolean }
  | ({ id: number; kind: 'convert'; text: string; format: TextualFormat | 'html-fragment' } & ConvertRequest)
  | ({ id: number; kind: 'epub'; text: string; title: string; author?: string } & ConvertRequest);

export type Response = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

declare const self: DedicatedWorkerGlobalScope;

let bib: BibIndex | null = null;

self.onmessage = (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    let value: unknown;
    if (req.kind === 'bibliography') {
      bib = req.entries?.length ? new BibIndex(req.entries) : null;
      self.postMessage({ id: req.id, ok: true, value: bib?.size ?? 0 } satisfies Response);
      return;
    }
    // I file di testo semplice non sono Markdown: ogni paragrafo resta testo.
    const src = req.plain ? parsePlain(req.text) : req.text;
    switch (req.kind) {
      case 'analyze':
        value = analyze(src, req.fallback);
        break;
      case 'convert':
        value = convertDocument(src, req.format, {
          title: req.title,
          lang: req.lang,
          notes: req.notes,
          bib: req.cite ? bib : null,
          bibFile: req.bibFile,
        });
        break;
      case 'epub': {
        const b = req.cite ? bib : null;
        const bytes = buildEpub(parse(src, { citeKeys: b?.keys }), { title: req.title, author: req.author }, { lang: req.lang, notes: req.notes, bib: b });
        self.postMessage({ id: req.id, ok: true, value: bytes } satisfies Response, [bytes.buffer]);
        return;
      }
    }
    self.postMessage({ id: req.id, ok: true, value } satisfies Response);
  } catch (err) {
    self.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies Response);
  }
};
