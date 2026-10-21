<script lang="ts">
  import {
    Bold,
    BookOpen,
    ChevronDown,
    Code,
    FileText,
    Italic,
    Link,
    List,
    ListOrdered,
    NotebookPen,
    Quote,
    SquareCode,
    SquarePen,
    Strikethrough,
    TextQuote,
    Underline,
  } from 'lucide';
  import Icon from './Icon.svelte';
  import { actions } from '../lib/actions';
  import { editor } from '../lib/editor/controller';
  import { active } from '../lib/editor/active.svelte';
  import type { BlockKind, InlineKind } from '../lib/editor/format';
  import { keys, t, tk } from '../lib/i18n';
  import { pdfEdit } from '../lib/pdfedit/session.svelte';
  import { READ_LABELS, doc, readState, setReadState, ui, type ReadState } from '../lib/state.svelte';

  const BLOCKS: { id: BlockKind; label: string; keys: string }[] = [
    { id: 'p', label: tk('Paragrafo'), keys: 'Ctrl+0' },
    { id: 'h1', label: tk('Titolo 1'), keys: 'Ctrl+1' },
    { id: 'h2', label: tk('Titolo 2'), keys: 'Ctrl+2' },
    { id: 'h3', label: tk('Titolo 3'), keys: 'Ctrl+3' },
    { id: 'h4', label: tk('Titolo 4'), keys: 'Ctrl+4' },
  ];

  let blockOpen = $state(false);
  const blockLabel = $derived(
    t(
      active.block === 'quote'
        ? tk('Citazione')
        : active.block === 'code'
          ? tk('Codice')
          : active.block === 'ul' || active.block === 'ol'
            ? tk('Elenco')
            : (BLOCKS.find((b) => b.id === active.block)?.label ?? tk('Paragrafo')),
    ),
  );

  const SOURCE_LABELS: Record<string, string> = {
    txt: tk('Testo semplice: senza formattazione'),
    tex: tk('Sorgente LaTeX'),
    typ: tk('Sorgente Typst'),
    html: tk('Sorgente HTML'),
  };

  /** «Grassetto (Ctrl+B)» con i tasti del sistema. */
  const tip = (label: string, combo: string) => `${t(label)} (${keys(combo)})`;

  // Il clic sulla barra non deve togliere il fuoco (e la selezione) all'editor.
  function keep(e: MouseEvent) {
    e.preventDefault();
  }
  const inline = (k: InlineKind) => editor.inline(k);
  const block = (k: BlockKind) => {
    editor.block(k);
    blockOpen = false;
  };

  const STATES: ReadState[] = ['unread', 'reading', 'read'];
  const current = $derived(readState(doc.key));
</script>

{#if pdfEdit.active}
  <div class="bar source">
    <span class="source-label">{t('Modifica delle pagine del PDF: le modifiche restano qui finché non salvi.')}</span>
  </div>
{:else if doc.mode === 'read'}
  <div class="bar reading" role="toolbar" aria-label={t('Lettura')}>
    {#if doc.readKind === 'pdf'}
      <div class="seg" role="radiogroup" aria-label={t('Vista del PDF')}>
        <button role="radio" aria-checked={doc.pdfView === 'text'} class:on={doc.pdfView === 'text'} onclick={() => (doc.pdfView = 'text')}>
          <Icon icon={FileText} size={15} /> {t('Testo')}
        </button>
        <button role="radio" aria-checked={doc.pdfView === 'pages'} class:on={doc.pdfView === 'pages'} onclick={() => (doc.pdfView = 'pages')}>
          <Icon icon={BookOpen} size={15} /> {t('Pagine')}
        </button>
      </div>
      <span class="sep"></span>
    {/if}
    <div class="seg" role="radiogroup" aria-label={t('Stato di lettura')}>
      {#each STATES as s (s)}
        <button role="radio" aria-checked={current === s} class:on={current === s} onclick={() => setReadState(doc.key, s)}>
          <span class="state-mark {s}"></span>{t(READ_LABELS[s])}
        </button>
      {/each}
    </div>
    <span class="sep"></span>
    <button class="tb note" onmousedown={keep} onclick={actions.startNote} disabled={ui.selectionEmpty || doc.pdfView === 'pages'} title={tip('Nota sul testo selezionato', 'Ctrl+M')}>
      <Icon icon={NotebookPen} /> <span>{t('Nota')}</span>
    </button>
    {#if doc.readKind === 'pdf'}
      <button class="tb edit" onclick={actions.editPdf} title={t('Modifica le pagine del PDF conservando l\'impaginazione: testo, evidenziazioni, pagine')}>
        <Icon icon={SquarePen} /> <span>{t('Modifica il PDF')}</span>
      </button>
    {/if}
    {#if doc.readKind}
      <button class="tb edit" onclick={actions.edit} title={t('Rendi modificabile il testo: poi salvi una copia modificata o aggiorni l\'originale')}>
        <Icon icon={SquarePen} /> <span>{doc.readKind === 'pdf' ? t('Modifica il testo') : t('Modifica')}</span>
      </button>
    {/if}
  </div>
{:else if doc.format !== 'md'}
  <div class="bar source" role="toolbar" aria-label={t('Formattazione')}>
    <span class="source-label">{t(SOURCE_LABELS[doc.format])}</span>
    <span class="sep"></span>
    <button class="tb note" onmousedown={keep} onclick={actions.startNote} disabled={ui.selectionEmpty} title={tip('Nota sul testo selezionato', 'Ctrl+M')}>
      <Icon icon={NotebookPen} /> <span>{t('Nota')}</span>
    </button>
  </div>
{:else}
  <div class="bar" role="toolbar" aria-label={t('Formattazione')}>
    <div class="block-anchor">
      <button class="block-btn" onmousedown={keep} onclick={() => (blockOpen = !blockOpen)} aria-haspopup="listbox" aria-expanded={blockOpen} title={t('Stile del paragrafo')}>
        <span>{blockLabel}</span>
        <Icon icon={ChevronDown} size={14} />
      </button>
      {#if blockOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
        <div class="dismiss" onclick={() => (blockOpen = false)}></div>
        <ul class="block-menu" role="listbox" aria-label={t('Stile del paragrafo')}>
          {#each BLOCKS as b (b.id)}
            <li role="option" aria-selected={active.block === b.id}>
              <button class="block-item {b.id}" onmousedown={keep} onclick={() => block(b.id)}>
                <span class="label">{t(b.label)}</span>
                <span class="keys">{keys(b.keys)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <span class="sep"></span>
    <button class="icon-btn" aria-pressed={active.strong} onmousedown={keep} onclick={() => inline('strong')} title={tip('Grassetto', 'Ctrl+B')} aria-label={t('Grassetto')}><Icon icon={Bold} /></button>
    <button class="icon-btn" aria-pressed={active.em} onmousedown={keep} onclick={() => inline('em')} title={tip('Corsivo', 'Ctrl+I')} aria-label={t('Corsivo')}><Icon icon={Italic} /></button>
    <button class="icon-btn" aria-pressed={active.u} onmousedown={keep} onclick={() => inline('u')} title={tip('Sottolineato', 'Ctrl+U')} aria-label={t('Sottolineato')}><Icon icon={Underline} /></button>
    <button class="icon-btn" aria-pressed={active.s} onmousedown={keep} onclick={() => inline('s')} title={tip('Barrato', 'Ctrl+Shift+X')} aria-label={t('Barrato')}><Icon icon={Strikethrough} /></button>
    <span class="sep"></span>
    <button class="icon-btn" aria-pressed={active.block === 'ul'} onmousedown={keep} onclick={() => block('ul')} title={tip('Elenco puntato', 'Ctrl+Shift+8')} aria-label={t('Elenco puntato')}><Icon icon={List} /></button>
    <button class="icon-btn" aria-pressed={active.block === 'ol'} onmousedown={keep} onclick={() => block('ol')} title={tip('Elenco numerato', 'Ctrl+Shift+7')} aria-label={t('Elenco numerato')}><Icon icon={ListOrdered} /></button>
    <button class="icon-btn" aria-pressed={active.block === 'quote'} onmousedown={keep} onclick={() => block('quote')} title={tip('Citazione', 'Ctrl+Shift+Q')} aria-label={t('Citazione')}><Icon icon={TextQuote} /></button>
    <button class="icon-btn" aria-pressed={active.block === 'code'} onmousedown={keep} onclick={() => block('code')} title={tip('Blocco di codice', 'Ctrl+Alt+C')} aria-label={t('Blocco di codice')}><Icon icon={SquareCode} /></button>
    <button class="icon-btn" aria-pressed={active.code} onmousedown={keep} onclick={() => inline('code')} title={tip('Codice nel testo', 'Ctrl+E')} aria-label={t('Codice nel testo')}><Icon icon={Code} /></button>
    <span class="sep"></span>
    <button class="icon-btn" aria-pressed={active.link} onmousedown={keep} onclick={() => editor.requestLink()} title={tip('Collegamento', 'Ctrl+K')} aria-label={t('Collegamento')}><Icon icon={Link} /></button>
    <button class="tb cite" onmousedown={keep} onclick={actions.cite} title={tip('Cita un\'opera della bibliografia', 'Ctrl+Shift+C')}>
      <Icon icon={Quote} /> <span>{t('Cita')}</span>
    </button>
    <button class="tb note" onmousedown={keep} onclick={actions.startNote} disabled={ui.selectionEmpty} title={tip('Nota sul testo selezionato', 'Ctrl+M')}>
      <Icon icon={NotebookPen} /> <span>{t('Nota')}</span>
    </button>
  </div>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 1px;
    height: 32px;
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--rule);
    margin: 0 7px;
  }
  .block-anchor {
    position: relative;
  }
  .block-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 116px;
    height: 30px;
    padding: 0 8px 0 10px;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--ink);
    font-weight: 500;
  }
  .block-btn:hover,
  .block-btn[aria-expanded='true'] {
    background: var(--chrome-2);
  }
  .dismiss {
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .block-menu {
    position: absolute;
    top: 36px;
    left: -4px;
    z-index: 31;
    width: 230px;
    margin: 0;
    padding: 5px;
    list-style: none;
    background: var(--raised);
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow);
    animation: rise 140ms var(--ease);
  }
  .block-item {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    width: 100%;
    padding: 6px 10px;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    text-align: left;
  }
  .block-item:hover {
    background: var(--chrome);
  }
  [aria-selected='true'] .block-item {
    background: var(--chrome-2);
  }
  .block-item .label {
    font-family: var(--font);
    color: var(--ink);
  }
  .block-item.p .label {
    font-size: 14px;
  }
  .block-item.h1 .label {
    font-size: 21px;
    font-weight: 650;
  }
  .block-item.h2 .label {
    font-size: 18px;
    font-weight: 650;
  }
  .block-item.h3 .label {
    font-size: 15.5px;
    font-weight: 650;
  }
  .block-item.h4 .label {
    font-size: 14px;
    font-weight: 650;
  }
  .keys {
    color: var(--ink-3);
    font-size: 11px;
  }
  .tb {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--ink-2);
    font-weight: 500;
  }
  .tb:hover {
    background: var(--chrome-2);
    color: var(--ink);
  }
  .tb:disabled {
    opacity: 0.4;
    pointer-events: none;
  }
  .tb.note {
    color: var(--rubric);
  }
  .tb.note:hover {
    background: var(--rubric-wash);
    color: var(--rubric);
  }
  .tb.edit {
    margin-left: 4px;
    border: 1px solid var(--rule);
    color: var(--ink);
  }
  .tb.edit:hover {
    border-color: var(--ink-4);
  }
  .source-label {
    color: var(--ink-2);
    padding: 0 6px;
  }
  .seg {
    display: inline-flex;
    padding: 2px;
    border-radius: var(--radius-m);
    background: var(--chrome);
    gap: 2px;
  }
  .seg button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-2);
    font-size: 12.5px;
  }
  .seg button:hover {
    color: var(--ink);
  }
  .seg button.on {
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow-s);
  }
  .state-mark {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--unread);
  }
  .state-mark.reading {
    border-color: var(--reading);
    background: linear-gradient(90deg, var(--reading) 50%, transparent 50%);
  }
  .state-mark.read {
    border-color: var(--read);
    background: var(--read);
  }
  @media (max-width: 1080px) {
    .tb.note span,
    .tb.cite span {
      display: none;
    }
  }
  @media (max-width: 1180px) {
    .bar.reading .tb.edit span {
      display: none;
    }
  }
  @media (max-width: 980px) {
    .bar.reading .seg button {
      padding: 0 7px;
    }
  }
</style>
