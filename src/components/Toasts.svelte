<script lang="ts">
  import { dismiss, ui } from '../lib/state.svelte';
  import { t } from '../lib/i18n';
</script>

<div class="toasts" aria-live="polite">
  {#each ui.toasts as toast (toast.id)}
    <div class="toast {toast.kind}" role={toast.kind === 'error' ? 'alert' : 'status'}>
      <span>{toast.text}</span>
      {#if toast.action}
        <button
          onclick={() => {
            toast.action!.run();
            dismiss(toast.id);
          }}>{toast.action.label}</button
        >
      {/if}
      <button class="x" onclick={() => dismiss(toast.id)} aria-label={t('Chiudi')}>×</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: calc(var(--status-h) + 14px);
    transform: translateX(-50%);
    z-index: 60;
    display: grid;
    gap: 8px;
    justify-items: center;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: min(560px, calc(100vw - 40px));
    padding: 8px 8px 8px 14px;
    border-radius: var(--radius-m);
    background: var(--ink);
    color: var(--page);
    box-shadow: var(--shadow);
    font-size: 12.5px;
    line-height: 1.4;
    animation: rise 180ms var(--ease);
  }
  .toast.error {
    background: var(--rubric);
    color: #fff;
  }
  button {
    border: 0;
    background: transparent;
    color: inherit;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
  }
  button:hover {
    background: color-mix(in srgb, currentColor 14%, transparent);
  }
  .x {
    font-size: 16px;
    font-weight: 400;
    opacity: 0.7;
  }
</style>
