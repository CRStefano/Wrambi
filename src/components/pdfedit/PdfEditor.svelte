<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    ArrowDown,
    ArrowUp,
    Bold,
    FilePlus2,
    Highlighter,
    ImagePlus,
    Italic,
    MousePointer2,
    Redo2,
    RotateCcw,
    RotateCw,
    Square,
    TextCursorInput,
    Trash2,
    Type,
    Undo2,
    X,
    ZoomIn,
    ZoomOut,
    FileStack,
    Info,
    ChevronDown,
  } from 'lucide';
  import Icon from '../Icon.svelte';
  import EditPage from './EditPage.svelte';
  import Thumb from './Thumb.svelte';
  import { backend, basename, dialogs } from '../../lib/backend';
  import { keys, t, tk, tn } from '../../lib/i18n';
  import { rgbToHex, hexToRgb, View, type RGB } from '../../lib/pdfedit/model';
  import {
    addOp,
    appendPdf,
    closePdfEdit,
    deletePage,
    images,
    insertBlankAfter,
    loadImage,
    movePage,
    newId,
    pageGeometry,
    pdfEdit,
    redo,
    removeOp,
    rotatePage,
    saveCopy,
    saveOver,
    undo,
    updateOp,
    type Tool,
  } from '../../lib/pdfedit/session.svelte';
  import { notify } from '../../lib/state.svelte';

  let scroller: HTMLDivElement;
  let areaWidth = $state(800);
  let current = $state<string | null>(null);
  let saveMenu = $state(false);

  const pageWidth = $derived(Math.round(Math.min(980, Math.max(320, areaWidth - 64)) * pdfEdit.zoom));

  const TOOLS: { id: Tool; label: string; icon: typeof Type; hint: string }[] = [
    { id: 'edit', label: tk('Modifica testo'), icon: TextCursorInput, hint: tk('Clic su una riga per riscriverla: il testo nuovo prende il posto del vecchio, con un carattere simile.') },
    { id: 'text', label: tk('Aggiungi testo'), icon: Type, hint: tk('Clic dove vuoi scrivere. Carattere, dimensione e colore si scelgono qui sopra.') },
    { id: 'highlight', label: tk('Evidenzia'), icon: Highlighter, hint: tk('Trascina sul testo (o clic su una riga) per evidenziarlo.') },
    { id: 'cover', label: tk('Copri'), icon: Square, hint: tk('Trascina un rettangolo per coprire una parte della pagina con il colore dello sfondo.') },
    { id: 'image', label: tk('Immagine'), icon: ImagePlus, hint: tk('Sceglie un\'immagine PNG o JPEG e la mette nella pagina in vista; poi la sposti e la ridimensioni.') },
    { id: 'select', label: tk('Sposta'), icon: MousePointer2, hint: tk('Clic su una modifica per sceglierla, trascina per spostarla, Canc per toglierla.') },
  ];
  const hint = $derived(TOOLS.find((x) => x.id === pdfEdit.tool)?.hint ?? '');

  const selectedOp = $derived(pdfEdit.ops.find((o) => o.id === pdfEdit.selected) ?? null);
  const textTarget = $derived(selectedOp && (selectedOp.kind === 'text' || selectedOp.kind === 'replace') ? selectedOp : null);
  const showTextStyle = $derived(pdfEdit.tool === 'text' || !!textTarget);

  onMount(() => {
    const ro = new ResizeObserver(() => (areaWidth = scroller.clientWidth));
    ro.observe(scroller);
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        e.stopPropagation();
        redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && pdfEdit.selected) {
        e.preventDefault();
        removeOp(pdfEdit.selected);
      } else if (mod && e.key.toLowerCase() === 's' && !typing) {
        e.preventDefault();
        e.stopPropagation();
        void saveCopy();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  });

  /** Pagina più visibile (per le miniature e per dove inserire le immagini). */
  function onScroll() {
    const mid = scroller.scrollTop + scroller.clientHeight / 3;
    let best: string | null = null;
    for (const el of scroller.querySelectorAll<HTMLElement>('[data-page]')) {
      if (el.offsetTop <= mid) best = el.dataset.page!;
      else break;
    }
    current = best ?? pdfEdit.pages[0]?.id ?? null;
  }

  async function goTo(id: string) {
    await tick();
    const el = scroller.querySelector<HTMLElement>(`[data-page="${id}"]`);
    if (el) scroller.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' });
    current = id;
  }

  async function chooseTool(id: Tool) {
    if (id === 'image') {
      const path = await dialogs.pickFile(t('Scegli un\'immagine'), [{ name: t('Immagini'), extensions: ['png', 'jpg', 'jpeg'] }]);
      if (!path) return;
      try {
        const imageId = await loadImage(await backend.readBinary(path));
        const img = images.get(imageId)!;
        const ref = pdfEdit.pages.find((p) => p.id === current) ?? pdfEdit.pages[0];
        const { viewBox, rotation } = await pageGeometry(ref);
        const view = new View(viewBox, 1, rotation);
        // Un terzo della larghezza della pagina (come appare), al centro, dritta sullo schermo.
        const w = Math.min(img.width * 0.75, view.width / 3);
        const h = (w * img.height) / img.width;
        const [x, y] = view.toPdf((view.width - w) / 2, (view.height + h) / 2);
        addOp({ kind: 'image', id: newId(), page: ref.id, image: imageId, box: { x, y, w, h, angle: view.uprightAngle() } });
        pdfEdit.tool = 'select';
        notify(t('Immagine aggiunta: trascinala dove serve, l\'angolo in basso a destra la ridimensiona.'), 'info');
      } catch (e) {
        notify((e as Error).message, 'error');
      }
      return;
    }
    pdfEdit.tool = id;
    pdfEdit.selected = null;
  }

  function setFont(patch: Partial<typeof pdfEdit.font>) {
    pdfEdit.font = { ...pdfEdit.font, ...patch };
    if (textTarget) updateOp(textTarget.id, { font: { ...textTarget.font, ...patch } });
  }
  function setSize(size: number) {
    if (!size || size < 4 || size > 200) return;
    pdfEdit.size = size;
    if (textTarget) updateOp(textTarget.id, { size });
  }
  function setColor(hex: string) {
    const c = hexToRgb(hex);
    pdfEdit.color = c;
    if (textTarget) updateOp(textTarget.id, { color: c });
  }

  const HIGHLIGHTS: RGB[] = [
    [1, 0.86, 0.2],
    [0.55, 0.9, 0.45],
    [0.45, 0.78, 1],
    [1, 0.55, 0.75],
  ];

  const fontFamily = $derived(textTarget ? textTarget.font.family : pdfEdit.font.family);
  const fontBold = $derived(textTarget ? textTarget.font.bold : pdfEdit.font.bold);
  const fontItalic = $derived(textTarget ? textTarget.font.italic : pdfEdit.font.italic);
  const fontSize = $derived(textTarget ? Math.round(textTarget.size * 10) / 10 : pdfEdit.size);
  const fontColor = $derived(rgbToHex(textTarget ? textTarget.color : pdfEdit.color));

  async function close() {
    await closePdfEdit();
  }
</script>

<div class="pdfedit">
  <div class="bar" role="toolbar" aria-label={t('Modifica del PDF')}>
    <div class="tools" role="radiogroup" aria-label={t('Strumento')}>
      {#each TOOLS as tool (tool.id)}
        <button role="radio" aria-checked={pdfEdit.tool === tool.id} class:on={pdfEdit.tool === tool.id} onclick={() => chooseTool(tool.id)} title={t(tool.hint)}>
          <Icon icon={tool.icon} size={15} /><span>{t(tool.label)}</span>
        </button>
      {/each}
    </div>

    {#if showTextStyle}
      <span class="sep"></span>
      <select class="input mini" value={fontFamily} onchange={(e) => setFont({ family: e.currentTarget.value as 'serif' | 'sans' | 'mono' })} aria-label={t('Carattere')}>
        <option value="serif">Times</option>
        <option value="sans">Helvetica</option>
        <option value="mono">Courier</option>
      </select>
      <input class="input mini size" type="number" min="4" max="200" step="0.5" value={fontSize} onchange={(e) => setSize(Number(e.currentTarget.value))} aria-label={t('Dimensione in punti')} title={t('Dimensione in punti')} />
      <button class="icon-btn" aria-pressed={fontBold} onclick={() => setFont({ bold: !fontBold })} title={t('Grassetto')} aria-label={t('Grassetto')}><Icon icon={Bold} size={15} /></button>
      <button class="icon-btn" aria-pressed={fontItalic} onclick={() => setFont({ italic: !fontItalic })} title={t('Corsivo')} aria-label={t('Corsivo')}><Icon icon={Italic} size={15} /></button>
      <input class="color" type="color" value={fontColor} onchange={(e) => setColor(e.currentTarget.value)} title={t('Colore del testo')} aria-label={t('Colore del testo')} />
    {:else if pdfEdit.tool === 'highlight'}
      <span class="sep"></span>
      {#each HIGHLIGHTS as c (c.join())}
        <button class="swatch" class:on={pdfEdit.highlight.join() === c.join()} style="background:{rgbToHex(c)}" onclick={() => (pdfEdit.highlight = c)} aria-label={t('Colore dell\'evidenziatore')}></button>
      {/each}
    {/if}
    {#if selectedOp}
      <button class="icon-btn" onclick={() => removeOp(selectedOp.id)} title={t('Togli questa modifica (Canc)')} aria-label={t('Togli questa modifica')}><Icon icon={Trash2} size={15} /></button>
    {/if}

    <span class="sep"></span>
    <button class="icon-btn" onclick={undo} disabled={!pdfEdit.canUndo} title={`${t('Annulla')} (${keys('Ctrl+Z')})`} aria-label={t('Annulla')}><Icon icon={Undo2} size={16} /></button>
    <button class="icon-btn" onclick={redo} disabled={!pdfEdit.canRedo} title={`${t('Ripeti')} (${keys('Ctrl+Y')})`} aria-label={t('Ripeti')}><Icon icon={Redo2} size={16} /></button>
    <button class="icon-btn" onclick={() => (pdfEdit.zoom = Math.max(0.5, +(pdfEdit.zoom - 0.1).toFixed(2)))} title={t('Riduci')} aria-label={t('Riduci')}><Icon icon={ZoomOut} size={16} /></button>
    <span class="zoom">{Math.round(pdfEdit.zoom * 100)}%</span>
    <button class="icon-btn" onclick={() => (pdfEdit.zoom = Math.min(2.5, +(pdfEdit.zoom + 0.1).toFixed(2)))} title={t('Ingrandisci')} aria-label={t('Ingrandisci')}><Icon icon={ZoomIn} size={16} /></button>

    <span class="spacer"></span>
    <div class="save">
      <button class="btn primary slim" onclick={saveCopy} disabled={pdfEdit.saving || !pdfEdit.dirty} title={t('Salva le modifiche in un nuovo PDF accanto all\'originale')}>
        {pdfEdit.saving ? t('Salvataggio…') : t('Salva una copia')}
      </button>
      <button class="btn slim more" onclick={() => (saveMenu = !saveMenu)} disabled={pdfEdit.saving || !pdfEdit.dirty} aria-haspopup="menu" aria-expanded={saveMenu} aria-label={t('Altri modi di salvare')} title={t('Altri modi di salvare')}><Icon icon={ChevronDown} size={14} /></button>
      {#if saveMenu}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="dismiss" onclick={() => (saveMenu = false)}></div>
        <div class="menu" role="menu">
          <button role="menuitem" onclick={() => ((saveMenu = false), void saveOver())}>{t('Sostituisci l\'originale (con una copia di sicurezza)')}</button>
        </div>
      {/if}
    </div>
    <button class="icon-btn" onclick={close} title={t('Chiudi la modifica')} aria-label={t('Chiudi la modifica')}><Icon icon={X} size={16} /></button>
  </div>

  <div class="body">
    <aside class="thumbs" aria-label={t('Pagine')}>
      {#each pdfEdit.pages as p, i (p.id)}
        <div class="thumb" class:on={current === p.id}>
          <button class="thumb-btn" onclick={() => goTo(p.id)} aria-label={t('Pagina {n}', { n: i + 1 })}>
            <Thumb ref={p} />
          </button>
          <span class="num">{i + 1}</span>
          <div class="page-tools">
            <button class="icon-btn" onclick={() => rotatePage(p.id, -90)} title={t('Ruota a sinistra')} aria-label={t('Ruota a sinistra')}><Icon icon={RotateCcw} size={13} /></button>
            <button class="icon-btn" onclick={() => rotatePage(p.id, 90)} title={t('Ruota a destra')} aria-label={t('Ruota a destra')}><Icon icon={RotateCw} size={13} /></button>
            <button class="icon-btn" onclick={() => movePage(p.id, -1)} disabled={i === 0} title={t('Sposta prima')} aria-label={t('Sposta prima')}><Icon icon={ArrowUp} size={13} /></button>
            <button class="icon-btn" onclick={() => movePage(p.id, 1)} disabled={i === pdfEdit.pages.length - 1} title={t('Sposta dopo')} aria-label={t('Sposta dopo')}><Icon icon={ArrowDown} size={13} /></button>
            <button class="icon-btn" onclick={() => insertBlankAfter(p.id)} title={t('Inserisci una pagina vuota dopo questa')} aria-label={t('Inserisci una pagina vuota')}><Icon icon={FilePlus2} size={13} /></button>
            <button class="icon-btn danger" onclick={() => deletePage(p.id)} title={t('Elimina la pagina')} aria-label={t('Elimina la pagina')}><Icon icon={Trash2} size={13} /></button>
          </div>
        </div>
      {/each}
      <button class="btn slim add" onclick={appendPdf}><Icon icon={FileStack} size={14} />{t('Aggiungi un PDF…')}</button>
    </aside>

    <div class="scroller" bind:this={scroller} onscroll={onScroll}>
      <div class="stack">
        {#each pdfEdit.pages as p, i (p.id)}
          <EditPage ref={p} width={pageWidth} number={i + 1} />
        {/each}
      </div>
    </div>
  </div>

  <footer class="hint">
    <Icon icon={Info} size={14} />
    <span>{t(hint)}</span>
    <span class="honest">{t('Il testo sostituito o coperto resta nel file sotto la copertura: per eliminare dati riservati non basta coprirli.')}</span>
    <span class="count">{tn(pdfEdit.ops.length, '{n} modifica', '{n} modifiche')} · {tn(pdfEdit.pages.length, '{n} pagina', '{n} pagine')} · {basename(pdfEdit.path)}</span>
  </footer>
</div>

<style>
  .pdfedit {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr auto;
    background: var(--chrome);
    z-index: 4;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--rule);
    background: var(--page);
    flex-wrap: wrap;
  }
  .tools {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    border-radius: var(--radius-m);
    background: var(--chrome);
  }
  .tools button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-2);
    font-size: 12.5px;
  }
  .tools button:hover {
    color: var(--ink);
  }
  .tools button.on {
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow-s);
  }
  .sep {
    width: 1px;
    height: 20px;
    margin: 0 6px;
    background: var(--rule);
  }
  .spacer {
    flex: 1;
  }
  .mini {
    height: 28px;
    padding: 0 6px;
    font-size: 12.5px;
  }
  .size {
    width: 62px;
  }
  .color {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--rule);
    border-radius: 6px;
    background: transparent;
  }
  .swatch {
    width: 22px;
    height: 22px;
    border: 2px solid var(--page);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--rule);
  }
  .swatch.on {
    box-shadow: 0 0 0 2px var(--ink);
  }
  .zoom {
    min-width: 40px;
    text-align: center;
    font-size: 12px;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .save {
    position: relative;
    display: flex;
    gap: 4px;
    margin-right: 4px;
  }
  .slim {
    height: 30px;
    padding: 0 12px;
  }
  .more {
    padding: 0 8px;
  }
  .dismiss {
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .menu {
    position: absolute;
    right: 0;
    top: 36px;
    z-index: 31;
    padding: 5px;
    min-width: 280px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    background: var(--raised);
    box-shadow: var(--shadow);
  }
  .menu button {
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    text-align: left;
  }
  .menu button:hover {
    background: var(--chrome);
  }
  .body {
    display: flex;
    min-height: 0;
  }
  .thumbs {
    flex: none;
    width: 168px;
    overflow: auto;
    padding: 12px 10px 20px;
    border-right: 1px solid var(--rule);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .thumb {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 4px;
  }
  .thumb-btn {
    padding: 0;
    border: 2px solid transparent;
    border-radius: 4px;
    background: transparent;
  }
  .thumb.on .thumb-btn {
    border-color: var(--focus, #2f6fde);
  }
  .num {
    font-size: 11px;
    color: var(--ink-3);
  }
  .page-tools {
    display: flex;
    gap: 0;
    opacity: 0;
    transition: opacity 120ms;
  }
  .thumb:hover .page-tools,
  .thumb:focus-within .page-tools,
  .thumb.on .page-tools {
    opacity: 1;
  }
  .page-tools .icon-btn {
    width: 22px;
    height: 22px;
  }
  .page-tools .danger:hover {
    color: var(--rubric);
    background: var(--rubric-wash);
  }
  .add {
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .scroller {
    flex: 1;
    min-width: 0;
    overflow: auto;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: 24px 32px 80px;
  }
  .hint {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 4px 14px;
    border-top: 1px solid var(--rule);
    background: var(--page);
    font-size: 12px;
    color: var(--ink-2);
  }
  .honest {
    color: var(--ink-3);
  }
  .count {
    margin-left: auto;
    color: var(--ink-3);
    white-space: nowrap;
  }
  @media (max-width: 1240px) {
    .tools button span {
      display: none;
    }
    .honest {
      display: none;
    }
  }
</style>
