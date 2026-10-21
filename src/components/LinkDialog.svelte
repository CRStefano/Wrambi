<script lang="ts">
  import { onMount } from 'svelte';
  import { editor } from '../lib/editor/controller';
  import { ui } from '../lib/state.svelte';
  import { t } from '../lib/i18n';

  const link = ui.link!;
  let text = $state(link.text);
  let href = $state(link.href);
  let urlInput: HTMLInputElement;
  let textInput: HTMLInputElement;

  onMount(() => (link.text && !link.href ? urlInput : link.text ? urlInput : textInput).focus());

  function apply(e?: Event) {
    e?.preventDefault();
    const url = href.trim();
    const finalUrl = url && !/^[a-z][a-z0-9+.-]*:|^[#/.]/i.test(url) && /\.[a-z]{2,}/i.test(url) ? 'https://' + url : url;
    editor.applyLink(link.from, link.to, text, finalUrl);
    ui.link = null;
  }

  function cancel() {
    ui.link = null;
    editor.focus();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={(e) => e.target === e.currentTarget && cancel()}>
  <form class="sheet" onsubmit={apply} aria-label={t('Collegamento')}>
    <div class="sheet-head"><h2>{link.href ? t('Modifica il collegamento') : t('Inserisci un collegamento')}</h2></div>
    <div class="sheet-body grid">
      <label class="field">
        <span>{t('Testo')}</span>
        <input class="input" bind:this={textInput} bind:value={text} placeholder={t('Testo da mostrare')} />
      </label>
      <label class="field">
        <span>{t('Indirizzo')}</span>
        <input class="input" bind:this={urlInput} bind:value={href} placeholder={t('https://… oppure capitolo-2.md')} spellcheck="false" />
      </label>
      {#if link.href}
        <p class="faint small">{t('Lascia vuoto l\'indirizzo per togliere il collegamento e tenere solo il testo.')}</p>
      {/if}
    </div>
    <div class="sheet-foot">
      <button type="button" class="btn" onclick={cancel}>{t('Annulla')}</button>
      <button type="submit" class="btn primary">{link.href ? t('Aggiorna') : t('Inserisci')}</button>
    </div>
  </form>
</div>

<style>
  .sheet {
    width: min(460px, calc(100vw - 32px));
  }
  .grid {
    display: grid;
    gap: 14px;
  }
  .small {
    margin: 0;
    font-size: 12px;
  }
</style>
