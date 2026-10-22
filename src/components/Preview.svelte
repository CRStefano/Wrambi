<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import { Copy, FileOutput, X } from 'lucide';
  import Icon from './Icon.svelte';
  import PdfPages from './PdfPages.svelte';
  import { backend, dirname, fromBase64, type Diagnostic } from '../lib/backend';
  import { converter } from '../lib/convert/client';
  import { formatInfo, type TextualFormat } from '../lib/convert';
  import { bibFileFor } from '../lib/convert/emit';
  import { conversionInput, exportableNotes, isConvertible, suggestedName, VIRTUAL_BIB } from '../lib/exporter';
  import { editor } from '../lib/editor/controller';
  import { buildPdfIndex, closePdfDocument, openPdf } from '../lib/reader/pdf';
  import { lowerBound, matchAt, normalize, pageToText, textToPage, type PagePoint, type PdfIndex } from '../lib/reader/textmap';
  import { editorNorm } from '../lib/reader/sync.svelte';
  import { doc, notify, save, settings, ui, type PreviewFormat } from '../lib/state.svelte';
  import { actions } from '../lib/actions';
  import { exportState } from '../lib/exportState.svelte';
  import { t, tk } from '../lib/i18n';

  const ALL: { id: PreviewFormat; label: string }[] = [
    { id: 'html', label: 'HTML' },
    { id: 'pdf', label: 'PDF' },
    { id: 'typ', label: 'Typst' },
    { id: 'tex', label: 'LaTeX' },
    { id: 'txt', label: tk('Testo') },
  ];

  const tabs = $derived.by(() => {
    if (doc.mode === 'edit' && doc.format === 'typ') return ALL.filter((x) => x.id === 'pdf');
    if (doc.mode === 'edit' && doc.format === 'html') return ALL.filter((x) => x.id === 'html');
    if (doc.mode === 'edit' && doc.format === 'tex') return [];
    return ALL;
  });
  const fmt = $derived<PreviewFormat>(tabs.find((x) => x.id === settings.previewFormat)?.id ?? tabs[0]?.id ?? 'html');

  let html = $state('');
  let source = $state('');
  let pdf = $state.raw<PDFDocumentProxy | null>(null);
  let pdfVersion = $state(0);
  let diagnostics = $state<Diagnostic[]>([]);
  let compiling = $state(false);
  let ms = $state<number | null>(null);
  let width = $state(Math.round(Math.min(720, Math.max(380, window.innerWidth * 0.42))));
  let body: HTMLDivElement | undefined = $state();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let pdfBusy = false;
  let pdfAgain = false;

  async function refresh() {
    const t0 = performance.now();
    try {
      if (fmt === 'html') {
        if (doc.mode === 'edit' && doc.format === 'html') html = editor.getText();
        else {
          const { text, opts } = await conversionInput();
          const r = await converter.preview(text, 'html-fragment', opts);
          if (r != null && r.text !== html) {
            html = r.text;
            htmlMap = null;
            await tick();
            scheduleFollow();
          }
        }
      } else if (fmt === 'pdf') {
        await refreshPdf();
      } else {
        const { text, opts } = await conversionInput();
        const r = await converter.preview(text, fmt as TextualFormat, { ...opts, bibFile: bibFileFor(suggestedName(fmt)) });
        if (r != null) source = r.text;
      }
      if (fmt !== 'pdf') ms = Math.round(performance.now() - t0);
    } catch (e) {
      source = '';
      diagnostics = [{ error: true, message: (e as Error).message, line: null, hints: [] }];
    }
  }

  async function refreshPdf() {
    if (pdfBusy) {
      pdfAgain = true;
      return;
    }
    pdfBusy = true;
    compiling = true;
    const t0 = performance.now();
    try {
      let typ: string;
      let bib: string | null = null;
      if (!isConvertible()) typ = editor.getText();
      else {
        const { text, opts } = await conversionInput();
        const r = await converter.convert(text, 'typ', { ...opts, bibFile: VIRTUAL_BIB });
        typ = r.text;
        bib = r.bib;
      }
      const res = await backend.typstCompile(typ, doc.path ? dirname(doc.path) : null, settings.systemFonts, bib);
      diagnostics = res.diagnostics;
      if (res.pdf) {
        const next = await openPdf(fromBase64(res.pdf));
        const old = pdf;
        pdf = next;
        pdfVersion++;
        closePdfDocument(old);
        // Il documento nuovo ha le stesse pagine più o meno nello stesso posto: si riallinea al testo.
        setTimeout(scheduleFollow, 60);
      }
      ms = Math.round(performance.now() - t0);
    } catch (e) {
      diagnostics = [{ error: true, message: (e as Error).message, line: null, hints: [] }];
    } finally {
      pdfBusy = false;
      compiling = false;
      if (pdfAgain) {
        pdfAgain = false;
        void refreshPdf();
      }
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, fmt === 'pdf' ? 550 : 90);
  }

  /* ───────────── L'anteprima segue il testo (come in Typst) ───────────── */

  let pages: PdfPages | undefined = $state();
  /** Testo delle pagine del PDF dell'anteprima, costruito quando serve. */
  let pdfIndex: { pdf: PDFDocumentProxy; index: PdfIndex | null; building: Promise<PdfIndex | null> } | null = null;

  async function indexOf(doc: PDFDocumentProxy): Promise<PdfIndex | null> {
    if (pdfIndex?.pdf === doc) return pdfIndex.index ?? pdfIndex.building;
    const building = buildPdfIndex(doc, () => pdf === doc);
    pdfIndex = { pdf: doc, index: null, building };
    const idx = await building;
    if (pdfIndex?.pdf === doc) pdfIndex.index = idx;
    return idx;
  }

  /** Testo ridotto dell'anteprima HTML, con il nodo di ogni carattere. */
  let htmlMap: { text: string; nodes: Text[]; offsets: number[] } | null = null;

  function htmlIndex() {
    if (htmlMap || !body) return htmlMap;
    const article = body.querySelector('.doc-preview') ?? body;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    const nodes: Text[] = [];
    const offsets: number[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const n = normalize((node as Text).data);
      parts.push(n.text);
      for (let i = 0; i < n.text.length; i++) {
        nodes.push(node as Text);
        offsets.push(n.map[i]);
      }
    }
    htmlMap = { text: parts.join(''), nodes, offsets };
    return htmlMap;
  }

  let following = 0;

  /** Porta l'anteprima al punto del testo che si sta leggendo o scrivendo. */
  async function follow() {
    if (!ui.preview || !body) return;
    const pos = editor.topPosition();
    const ed = editorNorm();
    if (fmt === 'pdf') {
      const doc = pdf;
      if (!doc || !pages) return;
      const idx = await indexOf(doc);
      if (!idx || doc !== pdf) return;
      const pt = textToPage(ed, pos, idx);
      if (pt) pages.scrollToPoint(pt);
    } else if (fmt === 'html' && !(doc.mode === 'edit' && doc.format === 'html')) {
      const map = htmlIndex();
      if (!map?.text.length) return;
      const k = Math.min(lowerBound(ed.map, pos), ed.text.length - 1);
      const at = matchAt(ed.text, k, map.text, (k / Math.max(1, ed.text.length)) * map.text.length);
      if (at == null) return;
      const range = document.createRange();
      range.setStart(map.nodes[at], map.offsets[at]);
      const r = range.getBoundingClientRect();
      const box = body.getBoundingClientRect();
      body.scrollTop += r.top - box.top - 40;
    }
  }

  function scheduleFollow() {
    cancelAnimationFrame(following);
    following = requestAnimationFrame(() => void follow());
  }

  /** Clic su una pagina dell'anteprima: il testo va a quel punto. */
  async function jumpToText(pt: PagePoint) {
    if (!pdf) return;
    const idx = await indexOf(pdf);
    if (!idx) return;
    const pos = pageToText(idx, pt, editorNorm());
    if (pos != null) editor.scrollToPosition(pos);
  }

  onMount(() => {
    const offChange = editor.onChange(() => {
      if (ui.preview) schedule();
    });
    const offScroll = editor.onScroll((ratio) => {
      if (!body) return;
      if (fmt === 'pdf' || (fmt === 'html' && !(doc.mode === 'edit' && doc.format === 'html'))) scheduleFollow();
      else body.scrollTop = ratio * (body.scrollHeight - body.clientHeight);
    });
    return () => {
      offChange();
      offScroll();
      clearTimeout(timer);
      closePdfDocument(pdf);
    };
  });

  // Nuovo documento, formato, lingua o note: aggiorna subito.
  $effect(() => {
    void fmt;
    void doc.key;
    void doc.format;
    void settings.exportNotes;
    void settings.docLanguage;
    void settings.bibliography;
    diagnostics = [];
    ms = null;
    void refresh();
  });

  function choose(id: PreviewFormat) {
    settings.previewFormat = id;
    save.settings();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      notify(t('Copiato negli appunti.'), 'ok');
    } catch {
      notify(t('Copia non riuscita.'), 'error');
    }
  }

  function exportThis() {
    exportState.format = fmt === 'html' ? 'html' : fmt;
    actions.openExport();
  }

  function startResize(e: PointerEvent) {
    const startX = e.clientX;
    const start = width;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      width = Math.min(Math.max(320, start - (ev.clientX - startX)), Math.round(window.innerWidth * 0.7));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  const errors = $derived(diagnostics.filter((d) => d.error));
  const warnings = $derived(diagnostics.filter((d) => !d.error));
  const fidelity = $derived(t(fmt === 'html' ? formatInfo('html').fidelity : formatInfo(fmt as 'pdf').fidelity));
  const hasNotes = $derived(isConvertible() && exportableNotes().length > 0);

  function toggleNotes() {
    settings.exportNotes = !settings.exportNotes;
    save.settings();
  }
</script>

<aside class="preview" style="width:{width}px" aria-label={t('Anteprima e conversione')}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resize" onpointerdown={startResize} title={t('Trascina per ridimensionare')}></div>
  <header>
    {#if tabs.length > 1}
      <div class="tabs" role="tablist">
        {#each tabs as tab (tab.id)}
          <button role="tab" aria-selected={fmt === tab.id} class:on={fmt === tab.id} onclick={() => choose(tab.id)}>{t(tab.label)}</button>
        {/each}
      </div>
    {:else}
      <h2>{tabs.length ? t('Anteprima PDF') : t('Anteprima')}</h2>
    {/if}
    <div class="tools">
      {#if fmt !== 'html' && fmt !== 'pdf' && tabs.length}
        <button class="icon-btn" onclick={copy} title={t('Copia il sorgente')} aria-label={t('Copia il sorgente')}><Icon icon={Copy} size={16} /></button>
      {/if}
      {#if tabs.length}
        <button class="icon-btn" onclick={exportThis} title={t('Esporta in questo formato')} aria-label={t('Esporta')}><Icon icon={FileOutput} size={16} /></button>
      {/if}
      <button class="icon-btn" onclick={() => (ui.preview = false)} title={t('Chiudi l\'anteprima')} aria-label={t('Chiudi')}><Icon icon={X} size={16} /></button>
    </div>
  </header>

  {#if !tabs.length}
    <div class="empty">
      <p>{t('Wrambi non include un motore LaTeX, quindi non può mostrare l\'impaginato di un sorgente .tex e non lo converte in altri formati.')}</p>
      <p class="faint">{t('Il sorgente si scrive e si salva normalmente; per il PDF compilalo con la tua installazione di LaTeX.')}</p>
    </div>
  {:else}
    <p class="fidelity">
      {doc.mode === 'read' ? t('Dal testo estratto.') + ' ' : ''}{fidelity}
      {#if ms != null}<span class="ms">{compiling ? t('compilazione…') : t('aggiornato in {ms} ms', { ms })}</span>{/if}
    </p>
    {#if hasNotes}
      <label class="notes-toggle">
        <input type="checkbox" checked={settings.exportNotes} onchange={toggleNotes} />
        {t('Note di Wrambi come note a piè di pagina')}
      </label>
    {/if}

    {#if errors.length || warnings.length}
      <ul class="diags">
        {#each [...errors, ...warnings].slice(0, 6) as d, i (i)}
          <li class:error={d.error}>
            {#if d.line && doc.format === 'typ' && doc.mode === 'edit'}
              <button class="line" onclick={() => editor.goToLine(d.line!)}>{t('riga {line}', { line: d.line })}</button>
            {:else if d.line}
              <span class="line">{t('riga {line}', { line: d.line })}</span>
            {/if}
            {d.message}{#if d.hints.length}<span class="hint"> {d.hints[0]}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}

    <div class="body" class:paper={fmt === 'pdf'} bind:this={body}>
      {#if fmt === 'html'}
        {#if doc.mode === 'edit' && doc.format === 'html'}
          <iframe title={t('Anteprima HTML')} sandbox="" srcdoc={html}></iframe>
        {:else}
          <article class="doc-preview">{@html html}</article>
        {/if}
      {:else if fmt === 'pdf'}
        {#if pdf}
          <PdfPages bind:this={pages} {pdf} docKey={'preview:' + doc.key} maxWidth={760} onpointclick={(pt) => void jumpToText(pt)} />
        {:else if !errors.length}
          <p class="faint pad">{t('Compilazione del PDF…')}</p>
        {/if}
      {:else}
        <pre class="source">{source}</pre>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .preview {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    min-width: 320px;
    border-left: 1px solid var(--rule);
    background: var(--page);
  }
  .resize {
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 2;
  }
  .resize:hover {
    background: color-mix(in srgb, var(--focus) 25%, transparent);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 8px 6px 14px;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .tabs {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    border-radius: var(--radius-m);
    background: var(--chrome);
  }
  .tabs button {
    height: 26px;
    padding: 0 11px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-2);
    font-size: 12.5px;
  }
  .tabs button:hover {
    color: var(--ink);
  }
  .tabs button.on {
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow-s);
  }
  .tools {
    display: flex;
    gap: 2px;
  }
  .fidelity {
    margin: 0;
    padding: 2px 16px 10px;
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--ink-3);
    border-bottom: 1px solid var(--rule);
  }
  .notes-toggle {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 16px;
    border-bottom: 1px solid var(--rule);
    font-size: 12px;
    color: var(--ink-2);
    cursor: pointer;
  }
  .notes-toggle input {
    margin: 0;
    accent-color: var(--ink);
  }
  .ms {
    margin-left: 6px;
    color: var(--ink-4);
    white-space: nowrap;
  }
  .diags {
    margin: 0;
    padding: 8px 16px;
    list-style: none;
    border-bottom: 1px solid var(--rule);
    font-size: 12px;
    max-height: 132px;
    overflow: auto;
    color: var(--warn);
  }
  .diags li {
    padding: 2px 0;
  }
  .diags li.error {
    color: var(--rubric);
  }
  .line {
    margin-right: 6px;
    padding: 0 5px;
    border: 1px solid currentColor;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font-size: 11px;
  }
  .hint {
    color: var(--ink-3);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--page);
  }
  .body.paper {
    background: var(--chrome);
    overflow: hidden;
  }
  .doc-preview {
    max-width: 680px;
    margin: 0 auto;
    padding: 28px 28px 80px;
  }
  .source {
    margin: 0;
    padding: 18px 18px 80px;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--ink);
    user-select: text;
  }
  iframe {
    width: 100%;
    height: 100%;
    border: 0;
    background: #fff;
  }
  .empty {
    padding: 20px 20px;
    line-height: 1.55;
  }
  .empty p {
    margin: 0 0 10px;
  }
  .pad {
    padding: 20px;
  }
</style>
