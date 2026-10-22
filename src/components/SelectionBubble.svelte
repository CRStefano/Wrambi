<script lang="ts">
  import { Highlighter, NotebookPen } from 'lucide';
  import Icon from './Icon.svelte';
  import { keys, t } from '../lib/i18n';

  let { rect, onhighlight, onnote }: { rect: DOMRect; onhighlight: () => void; onnote: () => void } = $props();

  // Sopra la selezione, centrata; sotto se in alto non c'è posto.
  const W = 220;
  const left = $derived(Math.min(Math.max(8, rect.left + rect.width / 2 - W / 2), window.innerWidth - W - 8));
  const above = $derived(rect.top > 64);
  const top = $derived(above ? rect.top - 44 : rect.bottom + 8);

  // Il clic sui pulsanti non deve togliere la selezione.
  const keep = (e: Event) => e.preventDefault();
</script>

<div class="bubble" style="left:{left}px;top:{top}px" role="toolbar" aria-label={t('Testo selezionato')}>
  <button onmousedown={keep} onclick={onhighlight} title="{t('Evidenzia')} ({keys('Ctrl+Shift+H')})">
    <span class="hl"><Icon icon={Highlighter} size={15} /></span>{t('Evidenzia')}
  </button>
  <span class="sep"></span>
  <button onmousedown={keep} onclick={onnote} title="{t('Nota sul testo selezionato')} ({keys('Ctrl+M')})">
    <Icon icon={NotebookPen} size={15} />{t('Nota')}
  </button>
</div>

<style>
  .bubble {
    position: fixed;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    background: var(--raised);
    border: 1px solid var(--rule);
    border-radius: 9px;
    box-shadow: var(--shadow);
    animation: pop 120ms var(--ease);
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink);
    font: 500 13px/1 var(--ui);
    cursor: pointer;
  }
  button:hover {
    background: var(--chrome-2, var(--chrome));
  }
  button:last-child {
    color: var(--rubric);
  }
  .hl {
    display: inline-flex;
    color: var(--marker-strong);
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--rule);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
