<script lang="ts">
  import { BellOff, Moon, Sun, Minus, Plus } from 'lucide';
  import Icon from './Icon.svelte';
  import { actions, FONT_MAX, FONT_MIN } from '../lib/actions';
  import { formatNumber, keys, locale, t, tk, tn } from '../lib/i18n';
  import { READ_LABELS, doc, readState, save, setReadState, settings, ui, type ReadState } from '../lib/state.svelte';

  const FORMAT_LABELS: Record<string, string> = { md: 'Markdown', txt: tk('Testo'), tex: 'LaTeX', typ: 'Typst', html: 'HTML' };
  const READ_KIND: Record<string, string> = { pdf: 'PDF', epub: 'EPUB', html: 'HTML' };

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  const saveLabel = $derived.by(() => {
    void now;
    void settings.language;
    if (doc.mode === 'read') return t('In lettura');
    if (doc.derived && !doc.derived.targetFormat) return t('Modifiche conservate, non ancora salvate in un file');
    if (doc.derived?.pending) return t('Da salvare in {format} ({keys})', { format: doc.derived.targetFormat!.toUpperCase(), keys: keys('Ctrl+S') });
    if (doc.error) return t('Salvataggio non riuscito');
    if (doc.saving) return t('Salvataggio…');
    if (doc.dirty) return t('Modifiche in corso');
    if (!doc.savedAt) return doc.draftId ? t('Bozza') : t('Aperto');
    const mins = Math.floor((Date.now() - doc.savedAt) / 60_000);
    const time = new Date(doc.savedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    if (doc.derived) {
      const format = doc.derived.targetFormat!.toUpperCase();
      return mins < 1 ? t('Salvato in {format} ora', { format }) : t('Salvato in {format} alle {time}', { format, time });
    }
    if (doc.draftId) return mins < 1 ? t('Bozza salvata ora') : t('Bozza salvata alle {time}', { time });
    return mins < 1 ? t('Salvato ora') : t('Salvato alle {time}', { time });
  });

  const showState = $derived(doc.mode === 'edit' && doc.key.startsWith('lib:'));
  const rstate = $derived(readState(doc.key));
  const NEXT: Record<ReadState, ReadState> = { unread: 'reading', reading: 'read', read: 'unread' };

  function toggleTheme() {
    settings.theme = ui.resolvedTheme === 'dark' ? 'light' : 'dark';
    save.settings();
  }
</script>

<footer class="statusbar">
  <div class="group">
    <span title={tn(doc.chars, '{n} carattere', '{n} caratteri')}>{tn(doc.words, '{n} parola', '{n} parole')}</span>
    <span class="faint">{doc.mode === 'read' ? READ_KIND[doc.readKind ?? ''] : doc.derived ? t('Testo modificabile di un {kind}', { kind: READ_KIND[doc.derived.kind] }) : t(FORMAT_LABELS[doc.format])}</span>
    <span class:error={!!doc.error} class="faint">{saveLabel}</span>
  </div>
  <div class="group">
    {#if showState}
      <button class="chip" onclick={() => setReadState(doc.key, NEXT[rstate])} title={t('Cambia lo stato di lettura')}>
        <span class="state-mark {rstate}"></span>{t(READ_LABELS[rstate])}
      </button>
    {/if}
    <button
      class="chip"
      class:on={ui.dnd}
      onclick={actions.toggleDnd}
      title={t('Non disturbare: Wrambi trattiene i propri avvisi finché scrivi ({keys}). Non controlla le notifiche del sistema.', { keys: keys('Ctrl+Shift+D') })}
    >
      <Icon icon={BellOff} size={14} />{ui.dnd && ui.queued.length ? tn(ui.queued.length, 'Non disturbare ({n} in attesa)', 'Non disturbare ({n} in attesa)') : t('Non disturbare')}
    </button>
    <button class="chip icon" onclick={toggleTheme} title={ui.resolvedTheme === 'dark' ? t('Tema chiaro') : t('Tema scuro')} aria-label={t('Cambia tema')}>
      <Icon icon={ui.resolvedTheme === 'dark' ? Sun : Moon} size={14} />
    </button>
    <div class="size" role="group" aria-label={t('Dimensione del testo')}>
      <button onclick={() => actions.fontSize(-1)} disabled={settings.fontSize <= FONT_MIN} title={`${t('Riduci il testo')} (${keys('Ctrl+-')})`} aria-label={t('Riduci il testo')}>
        <Icon icon={Minus} size={13} />
      </button>
      <button class="value" onclick={() => { settings.fontSize = 19; save.settings(); }} title={t('Dimensione del testo: clic per tornare a 19')}>{formatNumber(settings.fontSize)}</button>
      <button onclick={() => actions.fontSize(1)} disabled={settings.fontSize >= FONT_MAX} title={`${t('Ingrandisci il testo')} (${keys('Ctrl+=')})`} aria-label={t('Ingrandisci il testo')}>
        <Icon icon={Plus} size={13} />
      </button>
    </div>
  </div>
</footer>

<style>
  .statusbar {
    grid-row: 4;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--status-h);
    padding: 0 10px 0 16px;
    background: var(--page);
    border-top: 1px solid var(--rule);
    font-size: 12px;
    color: var(--ink-2);
  }
  .group {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .group:last-child {
    gap: 4px;
  }
  .error {
    color: var(--rubric);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ink-2);
    font-size: 12px;
  }
  .chip:hover {
    background: var(--chrome-2);
    color: var(--ink);
  }
  .chip.on {
    background: var(--ink);
    color: var(--page);
  }
  .chip.icon {
    width: 26px;
    padding: 0;
    justify-content: center;
  }
  .size {
    display: inline-flex;
    align-items: center;
    height: 22px;
    margin-left: 4px;
    border: 1px solid var(--rule);
    border-radius: 6px;
    overflow: hidden;
  }
  .size button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 100%;
    border: 0;
    background: transparent;
    color: var(--ink-2);
  }
  .size button:hover {
    background: var(--chrome-2);
    color: var(--ink);
  }
  .size button:disabled {
    opacity: 0.35;
  }
  .size .value {
    width: 30px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    border-left: 1px solid var(--rule);
    border-right: 1px solid var(--rule);
    color: var(--ink);
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
</style>
