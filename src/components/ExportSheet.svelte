<script lang="ts">
  import { FolderOpen, X } from 'lucide';
  import Icon from './Icon.svelte';
  import { dialogs, joinPath, revealInFolder, safeFileName, stripExt, backend } from '../lib/backend';
  import { exportChoices, exportTo, suggestedName, defaultExportDir, exportableNotes, isConvertible } from '../lib/exporter';
  import { exportState } from '../lib/exportState.svelte';
  import type { OutFormat } from '../lib/convert';
  import { bibFileFor } from '../lib/convert/emit';
  import { biblio } from '../lib/biblio/store.svelte';
  import { basename } from '../lib/backend';
  import { t, tn } from '../lib/i18n';
  import { notify, save, settings, ui } from '../lib/state.svelte';

  const choices = exportChoices();
  const firstAvailable = choices.find((c) => c.available)!.id;
  let format = $state<OutFormat>(
    exportState.format && choices.find((c) => c.id === exportState.format)?.available ? exportState.format : firstAvailable,
  );
  exportState.format = null;

  const choice = $derived(choices.find((c) => c.id === format)!);
  let dir = $state(defaultExportDir());
  let base = $state(stripExt(suggestedName('md')));
  let busy = $state(false);
  let remember = $state(false);

  const fileName = $derived(safeFileName(base) + '.' + choice.ext);
  const noteCount = isConvertible() ? exportableNotes().length : 0;
  const sourceWithBib = $derived((format === 'typ' || format === 'tex') && isConvertible() && biblio.count > 0);

  function toggleNotes() {
    settings.exportNotes = !settings.exportNotes;
    save.settings();
  }

  async function pickDir() {
    const p = await dialogs.pickFolder(t('Cartella di destinazione'), dir ?? undefined);
    if (p) {
      dir = p;
      remember = true;
    }
  }

  async function run() {
    let dest: string | null;
    if (!dir) {
      dest = await dialogs.saveFile(t('Esporta'), fileName, [{ name: t(choice.label), extensions: [choice.ext] }]);
      if (!dest) return;
    } else {
      dest = joinPath(dir, fileName);
      const info = await backend.fileInfo(dest).catch(() => null);
      if (info?.exists && !(await dialogs.ask(t('{name} esiste già in questa cartella. Vuoi sostituirlo?', { name: fileName }), t('Sostituisci')))) return;
    }
    busy = true;
    try {
      const written = await exportTo(format, dest);
      if (remember && dir) {
        settings.exportDir = dir;
        save.settings();
      }
      ui.exportOpen = false;
      const msg = written.bib
        ? t('Esportato: {name} (con {bib})', { name: basename(written.path), bib: basename(written.bib) })
        : t('Esportato: {name}', { name: basename(written.path) });
      notify(msg, 'ok', { label: t('Mostra nella cartella'), run: () => void revealInFolder(written.path) });
    } catch (e) {
      notify(t('Esportazione non riuscita: {message}', { message: (e as Error).message }), 'error');
    } finally {
      busy = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={(e) => e.target === e.currentTarget && !busy && (ui.exportOpen = false)} onkeydown={(e) => e.key === 'Escape' && !busy && (ui.exportOpen = false)}>
  <div class="sheet" role="dialog" aria-label={t('Esporta')} tabindex="-1" data-busy={busy}>
    <div class="sheet-head">
      <h2>{t('Esporta')}</h2>
      <button class="icon-btn" onclick={() => (ui.exportOpen = false)} aria-label={t('Chiudi')}><Icon icon={X} size={16} /></button>
    </div>
    <div class="sheet-body">
      <div class="formats" role="radiogroup" aria-label={t('Formato')}>
        {#each choices as c (c.id)}
          <button role="radio" aria-checked={format === c.id} class="fmt" class:on={format === c.id} disabled={!c.available} onclick={() => (format = c.id)}>
            <span class="name">{t(c.label)}</span>
            <span class="ext">.{c.ext}</span>
          </button>
        {/each}
      </div>
      <p class="fidelity">{choice.fidelity}</p>
      {#if choices.some((c) => !c.available)}
        <p class="limits">{choices.find((c) => !c.available)?.reason}</p>
      {/if}
      {#if noteCount > 0 && choice.available}
        <label class="check">
          <input type="checkbox" checked={settings.exportNotes} onchange={toggleNotes} />
          <span>
            {tn(noteCount, 'Includi la nota di Wrambi come nota a piè di pagina', 'Includi le {n} note di Wrambi come note a piè di pagina')}
            <small>{format === 'md' ? t('In Markdown diventano note di Pandoc: [^1].') : format === 'html' || format === 'epub' ? t('In HTML ed EPUB diventano note di chiusura numerate.') : format === 'txt' ? t('Nel testo semplice diventano rimandi [1] con le note in fondo.') : t('Ogni nota va a piè di pagina nel punto in cui finisce il passo annotato.')}</small>
          </span>
        </label>
      {/if}
      {#if sourceWithBib}
        <p class="limits">{t('Se il testo contiene citazioni, accanto al file viene scritto anche {bib} con le sole opere citate.', { bib: bibFileFor(fileName) })}</p>
      {/if}

      <div class="dest">
        <label class="field">
          <span>{t('Nome del file')}</span>
          <div class="name-row">
            <input class="input" bind:value={base} spellcheck="false" />
            <span class="suffix">.{choice.ext}</span>
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
    </div>
    <div class="sheet-foot">
      <button class="btn" onclick={() => (ui.exportOpen = false)} disabled={busy}>{t('Annulla')}</button>
      <button class="btn primary" onclick={run} disabled={busy || !base.trim()}>{busy ? t('Esportazione…') : t('Esporta in {format}', { format: t(choice.label) })}</button>
    </div>
  </div>
</div>

<style>
  .formats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
    gap: 6px;
  }
  .fmt {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 9px 11px;
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
  .fmt:disabled {
    opacity: 0.4;
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
  .limits {
    margin: 8px 2px 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--ink-3);
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    margin: 12px 2px 0;
    line-height: 1.4;
    cursor: pointer;
  }
  .check input {
    margin: 2px 0 0;
    accent-color: var(--ink);
  }
  .check small {
    display: block;
    margin-top: 2px;
    font-size: 12px;
    color: var(--ink-3);
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
</style>
