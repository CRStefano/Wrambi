<script lang="ts">
  import { CopyPlus, FileCheck2, FolderOpen, X } from 'lucide';
  import Icon from './Icon.svelte';
  import { backend, basename, dialogs, dirname, joinPath, normPath, safeFileName, stripExt } from '../lib/backend';
  import { displayName, draftDir, modifiedName, saveChanges } from '../lib/docs.svelte';
  import { doc, notify, settings, ui, type SaveFormat } from '../lib/state.svelte';
  import { t, tk } from '../lib/i18n';

  const LABELS: Record<SaveFormat, string> = {
    pdf: 'PDF',
    epub: 'EPUB',
    html: tk('Pagina HTML'),
    md: 'Markdown',
    txt: tk('Testo semplice'),
    tex: 'LaTeX',
    typ: 'Typst',
  };

  const edit = doc.derived ? { ...doc.derived } : null;
  const kind = edit?.kind ?? null;
  const original = doc.path;
  const isDraft = !original;

  /** Formati possibili: per un PDF, EPUB o HTML modificato prima il formato originale. */
  const formats: SaveFormat[] = edit
    ? [...new Set<SaveFormat>([kind!, 'md', 'pdf', 'epub', 'html', 'txt', 'tex', 'typ'])]
    : isDraft
      ? ['md', 'txt']
      : [doc.format === 'html' ? 'html' : (doc.format as SaveFormat)];

  let format = $state<SaveFormat>(edit?.targetFormat ?? formats[0]);
  /** «replace» aggiorna il file aperto; «copy» crea un nuovo file. */
  let mode = $state<'copy' | 'replace'>('copy');
  let backup = $state(true);
  let busy = $state(false);

  let dir = $state<string | null>(original ? dirname(original) : (draftDir(doc.draftId) ?? settings.libraryRoot ?? settings.exportDir ?? null));
  let stem = $state(isDraft ? safeFileName(doc.title || t('Senza titolo')) : stripExt(modifiedName('x')));

  const canReplace = $derived(!!edit && !!original && format === (edit.targetFormat ?? kind));
  $effect(() => {
    if (!canReplace && mode === 'replace') mode = 'copy';
  });

  const fileName = $derived(`${safeFileName(stem)}.${format}`);
  const sameAsOriginal = $derived(!!original && !!dir && normPath(joinPath(dir, fileName)) === normPath(original));

  const title = $derived(edit ? t('Salva le modifiche') : isDraft ? t('Salva il documento') : t('Salva una copia'));

  const fidelity = $derived.by(() => {
    const from = kind ? kind.toUpperCase() : '';
    switch (format) {
      case 'pdf':
        return (
          t('Wrambi impagina di nuovo il testo con Typst: titoli, elenchi, grassetto e corsivo restano.') +
          ' ' +
          (from === 'PDF'
            ? t('Impaginazione, immagini e caratteri del PDF originale non si conservano: per cambiare il PDF conservandone l\'aspetto usa «Modifica il PDF».')
            : t('Le immagini non vengono riportate.'))
        );
      case 'epub':
        return (
          t('Un nuovo libro EPUB con il testo, i titoli e gli elenchi.') +
          ' ' +
          (from === 'EPUB' ? t('Copertina, immagini e stili del libro originale non si conservano.') : t('Si apre in qualunque lettore di e-book.'))
        );
      case 'html':
        return t('Una pagina HTML pulita generata dal testo.') + (from === 'HTML' ? ' ' + t('Stili, script e immagini della pagina originale non si conservano.') : '');
      case 'md':
        return edit
          ? t('Il testo in Markdown, con titoli, elenchi e formattazione. Da qui in poi lavori sul file Markdown, che si salva da solo.')
          : t('Il testo così com\'è, in un nuovo file Markdown. Da qui in poi lavori sulla copia.');
      case 'txt':
        return t('Solo il testo, senza formattazione.');
      case 'tex':
        return edit
          ? t('Un sorgente LaTeX generato dal testo, da compilare con la tua installazione di LaTeX.')
          : t('Copia del sorgente LaTeX. Da qui in poi lavori sulla copia.');
      case 'typ':
        return edit
          ? t('Un sorgente Typst generato dal testo, modificabile e compilabile in PDF da Wrambi.')
          : t('Copia del sorgente Typst. Da qui in poi lavori sulla copia.');
    }
  });

  async function pickDir() {
    const p = await dialogs.pickFolder(t('Dove salvare'), dir ?? undefined);
    if (p) dir = p;
  }

  function close() {
    if (!busy) ui.saveSheet = false;
  }

  async function run() {
    let dest: string | null;
    const replace = mode === 'replace' && canReplace;
    if (replace) {
      dest = original!;
    } else if (!dir) {
      dest = await dialogs.saveFile(title, fileName, [{ name: t(LABELS[format]), extensions: [format] }]);
      if (!dest) return;
    } else {
      dest = joinPath(dir, fileName);
      if (sameAsOriginal) {
        notify(t('Per sovrascrivere il file aperto scegli «Aggiorna l\'originale», oppure cambia il nome.'), 'info');
        return;
      }
      const info = await backend.fileInfo(dest).catch(() => null);
      if (info?.exists && !(await dialogs.ask(t('{name} esiste già in questa cartella. Vuoi sostituirlo?', { name: fileName }), t('Sostituisci')))) return;
    }
    busy = true;
    try {
      await saveChanges({ format, dest, replace, backup: replace && backup });
      ui.saveSheet = false;
    } catch (e) {
      notify(t('Salvataggio non riuscito: {message}', { message: (e as Error).message }), 'error');
    } finally {
      busy = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="sheet" role="dialog" aria-label={title} tabindex="-1" data-busy={busy}>
    <div class="sheet-head">
      <h2>{title}</h2>
      <button class="icon-btn" onclick={close} aria-label={t('Chiudi')}><Icon icon={X} size={16} /></button>
    </div>
    <div class="sheet-body">
      {#if edit}
        <div class="modes" role="radiogroup" aria-label={t('Dove salvare')}>
          <button role="radio" aria-checked={mode === 'copy'} class="mode" class:on={mode === 'copy'} onclick={() => (mode = 'copy')}>
            <Icon icon={CopyPlus} size={18} />
            <span class="m-title">{t('Crea una copia modificata')}</span>
            <span class="m-sub">{t('{name}, l\'originale resta com\'è', { name: fileName })}</span>
          </button>
          <button
            role="radio"
            aria-checked={mode === 'replace'}
            class="mode"
            class:on={mode === 'replace'}
            disabled={!canReplace}
            onclick={() => (mode = 'replace')}
          >
            <Icon icon={FileCheck2} size={18} />
            <span class="m-title">{t('Aggiorna l\'originale')}</span>
            <span class="m-sub">{canReplace ? t('Riscrive {name}', { name: basename(original!) }) : t('Solo nel formato {format}', { format: ((edit.targetFormat ?? kind) || '').toUpperCase() })}</span>
          </button>
        </div>
      {/if}

      {#if formats.length > 1}
        <div class="formats" role="radiogroup" aria-label={t('Formato')}>
          {#each formats as f (f)}
            <button role="radio" aria-checked={format === f} class="fmt" class:on={format === f} onclick={() => (format = f)}>
              <span class="name">{t(LABELS[f])}</span>
              <span class="ext">.{f}{f === kind ? ', ' + t('come l\'originale') : ''}</span>
            </button>
          {/each}
        </div>
      {/if}
      <p class="fidelity">{fidelity}</p>

      {#if mode === 'replace'}
        <label class="check">
          <input type="checkbox" bind:checked={backup} />
          <span>{t('Prima conserva l\'originale accanto, come «{name}»', { name: `${stripExt(basename(original!))} (${t('originale')}).${format}` })}</span>
        </label>
      {:else}
        <div class="dest">
          <label class="field">
            <span>{t('Nome del file')}</span>
            <div class="name-row">
              <input class="input" bind:value={stem} spellcheck="false" />
              <span class="suffix">.{format}</span>
            </div>
          </label>
          <div class="field">
            <span>{t('Cartella')}</span>
            <div class="dir">
              <span title={dir ?? ''}>{dir ?? t('Da scegliere al momento')}</span>
              <button class="btn slim" onclick={pickDir}><Icon icon={FolderOpen} size={14} />{t('Cambia')}</button>
            </div>
          </div>
        </div>
        {#if !isDraft}
          <p class="hint">{t('Le note di «{name}» vengono copiate anche sul nuovo file.', { name: displayName(doc.name) })}</p>
        {/if}
      {/if}
    </div>
    <div class="sheet-foot">
      <button class="btn" onclick={close} disabled={busy}>{t('Annulla')}</button>
      <button class="btn primary" onclick={run} disabled={busy || (mode === 'copy' && !stem.trim())}>
        {busy ? t('Salvataggio…') : mode === 'replace' ? t('Aggiorna {name}', { name: basename(original!) }) : isDraft ? t('Salva') : t('Salva la copia')}
      </button>
    </div>
  </div>
</div>

<style>
  .modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 16px;
  }
  .mode {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 10px;
    row-gap: 2px;
    align-items: center;
    padding: 12px 14px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    background: var(--page);
    color: var(--ink-2);
    text-align: left;
  }
  .mode:hover {
    border-color: var(--ink-4);
  }
  .mode.on {
    border-color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--ink);
    color: var(--ink);
  }
  .mode:disabled {
    opacity: 0.45;
  }
  .m-title {
    font-weight: 600;
    color: var(--ink);
  }
  .m-sub {
    grid-column: 2;
    font-size: 12px;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .formats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
    gap: 6px;
  }
  .fmt {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 8px 11px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    background: var(--page);
    text-align: left;
  }
  .fmt:hover {
    border-color: var(--ink-4);
  }
  .fmt.on {
    border-color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--ink);
  }
  .name {
    font-weight: 600;
  }
  .ext {
    font-size: 11.5px;
    color: var(--ink-3);
  }
  .fidelity {
    margin: 14px 0 0;
    padding: 10px 12px;
    border-radius: var(--radius-m);
    background: var(--chrome);
    line-height: 1.5;
    color: var(--ink-2);
  }
  .check {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin-top: 16px;
    line-height: 1.4;
  }
  .check input {
    margin-top: 2px;
    accent-color: var(--ink);
  }
  .dest {
    display: grid;
    gap: 14px;
    margin-top: 18px;
  }
  .name-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .name-row .input {
    flex: 1;
  }
  .suffix {
    color: var(--ink-3);
  }
  .dir {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .dir span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-2);
  }
  .slim {
    height: 28px;
    padding: 0 10px;
  }
  .hint {
    margin: 12px 2px 0;
    font-size: 12px;
    color: var(--ink-3);
  }
</style>
