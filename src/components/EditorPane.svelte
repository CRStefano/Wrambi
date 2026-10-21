<script lang="ts">
  import { onMount } from 'svelte';
  import { editor } from '../lib/editor/controller';
  import { actions, popoverPlacement } from '../lib/actions';
  import { reader } from '../lib/docs.svelte';
  import { editorNoteMenu } from '../lib/notes/manage';
  import { doc, ui } from '../lib/state.svelte';
  import PdfPages from './PdfPages.svelte';
  import PdfEditor from './pdfedit/PdfEditor.svelte';
  import { pdfEdit } from '../lib/pdfedit/session.svelte';

  let host: HTMLDivElement;

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

  const pages = $derived(doc.readKind === 'pdf' && doc.pdfView === 'pages' && !!reader.pdf);
</script>

<div class="editor-host" class:hidden={pages} bind:this={host}></div>
{#if pages && reader.pdf}
  <div class="pages-host">
    <PdfPages pdf={reader.pdf} docKey={doc.key} />
  </div>
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
  .pages-host {
    position: absolute;
    inset: 0;
    overflow: auto;
    background: var(--chrome);
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
