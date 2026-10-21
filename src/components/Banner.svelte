<script lang="ts">
  import { Info, TriangleAlert, X } from 'lucide';
  import Icon from './Icon.svelte';
  import { doc } from '../lib/state.svelte';
  import { t } from '../lib/i18n';
</script>

{#if doc.banner}
  <div class="banner {doc.banner.kind}" role={doc.banner.kind === 'warn' ? 'alert' : 'status'}>
    <Icon icon={doc.banner.kind === 'warn' ? TriangleAlert : Info} size={15} />
    <p>{doc.banner.text}</p>
    {#each doc.banner.actions ?? [] as a (a.label)}
      <button class="act" onclick={a.run}>{a.label}</button>
    {/each}
    {#if doc.banner.kind === 'info'}
      <button class="icon-btn" onclick={() => (doc.banner = null)} aria-label={t('Chiudi l\'avviso')}><Icon icon={X} size={14} /></button>
    {/if}
  </div>
{/if}

<style>
  .banner {
    grid-row: 2;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px 6px 16px;
    border-bottom: 1px solid var(--rule);
    background: var(--chrome);
    color: var(--ink-2);
    font-size: 12.5px;
  }
  .banner.warn {
    background: color-mix(in srgb, var(--warn) 12%, var(--page));
    color: var(--ink);
  }
  .banner.warn :global(svg) {
    color: var(--warn);
  }
  p {
    flex: 1;
    margin: 0;
    line-height: 1.4;
  }
  .act {
    flex: none;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--rule);
    border-radius: 5px;
    background: var(--raised);
    font-size: 12px;
  }
  .act:hover {
    background: var(--chrome-2);
  }
  .icon-btn {
    width: 26px;
    height: 26px;
  }
</style>
