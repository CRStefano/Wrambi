<script lang="ts">
  import { onMount } from 'svelte';
  import { editor } from '../lib/editor/controller';
  import { actions, popoverPlacement } from '../lib/actions';
  import { reader } from '../lib/docs.svelte';
  import { editorNoteMenu } from '../lib/notes/manage';
  import { doc, ui } from '../lib/state.svelte';
  import PdfPages from './PdfPages.svelte';
  import SelectionBubble from './SelectionBubble.svelte';
  import PdfEditor from './pdfedit/PdfEditor.svelte';
  import { pdfEdit } from '../lib/pdfedit/session.svelte';
  import { annotateSelection, pageMarks, pageSelection, pagesAvailable, pagesScrolled, pagesStart, registerPages } from '../lib/reader/sync.svelte';

  let host: HTMLDivElement;
  let pages: PdfPages | undefined = $state();

  /** Selezione nel testo di un documento in lettura: proposta di evidenziare o annotare. */
  let textSel = $state<DOMRect | null>(null);
  let selTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    const off = editor.onSelection((info) => {
      clearTimeout(selTimer);
      if (info.empty || doc.mode !== 'read') {
        textSel = null;
        return;
      }
      // Si aspetta che la selezione si fermi (trascinamento del mouse).
      selTimer = setTimeout(() => (textSel = editor.view?.hasFocus ? editor.selectionRect() : null), 260);
    });
    const offScroll = editor.onScroll(() => (textSel = null));
    return () => {
      off();
      offScroll();
      clearTimeout(selTimer);
    };
  });

  function textAnnotate(kind: 'note' | 'highlight') {
    textSel = null;
    if (kind === 'note') actions.startNote();
    else actions.highlight();
  }

  onMount(() => {
    editor.mount(host);
    editor.setNoteClickHandler((id, rect) => {
      ui.popover = { noteId: id, ...popoverPlacement(rect) };
    });
    editor.setNoteContextHandler(editorNoteMenu);
    editor.onLinkRequest = (link) => (ui.link = link);
    editor.onNoteRequest = () => actions.startNote();
    editor.onCiteRequest = () => actions.cite();
  });

  /** Vista del PDF: testo, pagine o le due affiancate (che scorrono insieme). */
  const view = $derived(pagesAvailable() ? doc.pdfView : 'text');
  const showPages = $derived(view !== 'text' && !!reader.pdf);
  const marks = $derived(showPages ? pageMarks() : []);

  $effect(() => {
    const p = pages;
    registerPages(showPages && p ? { currentPoint: () => p.currentPoint(), scrollToPoint: (pt, o) => p.scrollToPoint(pt, o), flash: (id) => p.flashMark(id) } : null);
    return () => registerPages(null);
  });

  $effect(() => {
    // Cambiando documento o vista, la selezione sulle pagine non vale più.
    void doc.key;
    void view;
    pageSelection.sel = null;
  });
</script>

<div class="editor-host" class:hidden={view === 'pages'} class:left={view === 'split'} bind:this={host}></div>
{#if showPages && reader.pdf}
  <div class="pages-host" class:right={view === 'split'}>
    <PdfPages
      bind:this={pages}
      pdf={reader.pdf}
      docKey={doc.key}
      textLayer={!!reader.index}
      {marks}
      start={pagesStart.point}
      maxWidth={view === 'split' ? 760 : 900}
      onscrollpoint={pagesScrolled}
      onselection={(sel) => (pageSelection.sel = sel)}
      onmark={(id, rect) => (ui.popover = { noteId: id, ...popoverPlacement(rect) })}
      onmarkcontext={(id, x, y) => editorNoteMenu(id, x, y, new DOMRect(x, y, 0, 0))}
    />
  </div>
  {#if pageSelection.sel && !ui.popover}
    <SelectionBubble rect={pageSelection.sel.rect} onhighlight={() => annotateSelection('highlight')} onnote={() => annotateSelection('note')} />
  {/if}
{/if}
{#if textSel && view !== 'pages' && !ui.popover && doc.mode === 'read'}
  <SelectionBubble rect={textSel} onhighlight={() => textAnnotate('highlight')} onnote={() => textAnnotate('note')} />
{/if}
{#if pdfEdit.active && reader.pdf}
  <PdfEditor />
{/if}
{#if reader.loading}
  <div class="loading" role="status">
    <div class="bar"><span></span></div>
    <p>{reader.loading}</p>
  </div>
{/if}

<style>
  .editor-host {
    position: absolute;
    inset: 0;
  }
  .editor-host.hidden {
    visibility: hidden;
  }
  .editor-host.left {
    right: 50%;
  }
  .pages-host {
    position: absolute;
    inset: 0;
    overflow: auto;
    background: var(--chrome);
  }
  .pages-host.right {
    left: 50%;
    border-left: 1px solid var(--rule);
  }
  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 14px;
    background: var(--page);
    color: var(--ink-2);
    z-index: 5;
  }
  .loading p {
    margin: 0;
    font-size: 13px;
  }
  .bar {
    width: 180px;
    height: 3px;
    border-radius: 2px;
    background: var(--chrome-2);
    overflow: hidden;
  }
  .bar span {
    display: block;
    width: 40%;
    height: 100%;
    background: var(--ink-2);
    animation: slide 1.1s ease-in-out infinite;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(250%);
    }
  }
</style>
