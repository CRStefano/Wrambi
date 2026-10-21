<script lang="ts">
  import { X } from 'lucide';
  import Icon from './Icon.svelte';
  import { SHORTCUTS } from '../lib/actions';
  import { ui } from '../lib/state.svelte';
  import { keyName, t } from '../lib/i18n';

  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={(e) => e.target === e.currentTarget && (ui.shortcuts = false)} onkeydown={(e) => e.key === 'Escape' && (ui.shortcuts = false)}>
  <div class="sheet wide" role="dialog" aria-label={t('Scorciatoie da tastiera')} tabindex="-1">
    <div class="sheet-head">
      <h2>{t('Scorciatoie da tastiera')}</h2>
      <button class="icon-btn" onclick={() => (ui.shortcuts = false)} aria-label={t('Chiudi')}><Icon icon={X} size={16} /></button>
    </div>
    <div class="sheet-body cols">
      {#each groups as g (g)}
        <section>
          <h3>{t(g)}</h3>
          <dl>
            {#each SHORTCUTS.filter((s) => s.group === g) as s (s.keys)}
              <dt>{t(s.label)}</dt>
              <dd>
                {#each s.keys.split(' ') as part, i (i)}
                  {#if part === '/' || part === '…'}<span class="faint"> {part} </span>{:else}
                    {#each part.split('+') as k, j (j)}{#if j}<span class="plus">+</span>{/if}<span class="kbd">{keyName(k)}</span>{/each}
                  {/if}
                {/each}
              </dd>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
  </div>
</div>

<style>
  .wide {
    width: min(820px, calc(100vw - 32px));
  }
  .cols {
    columns: 2 340px;
    column-gap: 36px;
  }
  section {
    break-inside: avoid;
    margin-bottom: 18px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
  }
  dl {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px 16px;
    margin: 0;
  }
  dt {
    color: var(--ink-2);
  }
  dd {
    margin: 0;
    white-space: nowrap;
    text-align: right;
  }
  .plus {
    color: var(--ink-4);
    margin: 0 2px;
    font-size: 11px;
  }
</style>
