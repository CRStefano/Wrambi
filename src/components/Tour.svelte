<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ArrowLeft, ArrowRight, Compass, X } from 'lucide';
  import Icon from './Icon.svelte';
  import { TOUR, type TourLine } from '../lib/tour';
  import { keys, t } from '../lib/i18n';
  import { save, settings, ui } from '../lib/state.svelte';

  const total = TOUR.length;
  const step = $derived(TOUR[Math.min(ui.tour ?? 0, total - 1)]);
  const index = $derived(Math.min(ui.tour ?? 0, total - 1));

  let card: HTMLDivElement | undefined = $state();
  let hole = $state<DOMRect | null>(null);
  let pos = $state({ left: 0, top: 0 });
  let cardH = $state(320);
  const W = 460;

  function text(l: TourLine): string {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(l.keys ?? {})) params[k] = keys(v);
    return t(l.text, params);
  }

  /** Mette in luce l'elemento del passo e sistema il riquadro accanto. */
  async function place() {
    await tick();
    const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    const r = el?.getBoundingClientRect();
    hole = r && r.width > 0 && r.height > 0 ? r : null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = card?.offsetHeight ?? cardH;
    cardH = h;
    if (!hole) {
      pos = { left: (vw - W) / 2, top: Math.max(24, (vh - h) / 2) };
      return;
    }
    const pad = 14;
    const clampX = (x: number) => Math.min(Math.max(16, x), vw - W - 16);
    const clampY = (y: number) => Math.min(Math.max(16, y), vh - h - 16);
    if (hole.bottom + pad + h < vh - 8 && hole.height < vh * 0.6) pos = { left: clampX(hole.left + hole.width / 2 - W / 2), top: hole.bottom + pad };
    else if (hole.top - pad - h > 8) pos = { left: clampX(hole.left + hole.width / 2 - W / 2), top: hole.top - pad - h };
    else if (hole.right + pad + W < vw - 8) pos = { left: hole.right + pad, top: clampY(hole.top + 20) };
    else if (hole.left - pad - W > 8) pos = { left: hole.left - pad - W, top: clampY(hole.top + 20) };
    else pos = { left: clampX(hole.left + hole.width / 2 - W / 2), top: clampY(hole.top + hole.height / 2 - h / 2) };
  }

  $effect(() => {
    void index;
    step.enter?.();
    // La Biblioteca e le altre viste hanno bisogno di un momento per comparire.
    void place();
    const timer = setTimeout(() => void place(), 260);
    return () => clearTimeout(timer);
  });

  function close() {
    settings.tourSeen = true;
    save.settings();
    ui.tour = null;
  }

  function go(d: number) {
    const next = index + d;
    if (next < 0) return;
    if (next >= total) close();
    else ui.tour = next;
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onResize = () => void place();
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('resize', onResize);
    card?.focus();
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('resize', onResize);
    };
  });
</script>

<div class="tour" role="presentation">
  {#if hole}
    <div class="hole" style="left:{hole.left - 6}px;top:{hole.top - 6}px;width:{hole.width + 12}px;height:{hole.height + 12}px"></div>
  {:else}
    <div class="dim"></div>
  {/if}

  <div class="card" bind:this={card} style="left:{pos.left}px;top:{pos.top}px;width:{W}px" role="dialog" aria-modal="true" aria-labelledby="tour-title" tabindex="-1">
    <header>
      <span class="badge"><Icon icon={Compass} size={14} />{t('Tour di Wrambi')}</span>
      <span class="count">{index + 1} / {total}</span>
      <button class="icon-btn" onclick={close} aria-label={t('Chiudi il tour')} title={t('Chiudi il tour (Esc)')}><Icon icon={X} size={15} /></button>
    </header>
    <h2 id="tour-title">{t(step.title)}</h2>
    <p class="lead">{text(step.lead)}</p>
    {#if step.how?.length}
      <h3>{t('Come si usa')}</h3>
      <ul>
        {#each step.how as l (l.text)}
          <li>{text(l)}</li>
        {/each}
      </ul>
    {/if}
    {#if step.inside}
      <h3>{t('Come lo fa Wrambi')}</h3>
      <p class="inside">{text(step.inside)}</p>
    {/if}
    <footer>
      <div class="dots" aria-hidden="true">
        {#each TOUR as s, i (s.id)}
          <button class="dot" class:on={i === index} onclick={() => (ui.tour = i)} tabindex="-1" aria-label={t(s.title)}></button>
        {/each}
      </div>
      {#if index === 0}
        <button class="btn slim" onclick={close}>{t('Più tardi')}</button>
        <button class="btn primary slim" onclick={() => go(1)}>{t('Inizia il giro')}<Icon icon={ArrowRight} size={14} /></button>
      {:else}
        <button class="btn slim" onclick={() => go(-1)}><Icon icon={ArrowLeft} size={14} />{t('Indietro')}</button>
        <button class="btn primary slim" onclick={() => go(1)}>{index === total - 1 ? t('Fine') : t('Avanti')}{#if index < total - 1}<Icon icon={ArrowRight} size={14} />{/if}</button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .tour {
    position: fixed;
    inset: 0;
    z-index: 90;
  }
  .dim {
    position: absolute;
    inset: 0;
    background: rgb(15 20 30 / 0.45);
  }
  /* Il resto della finestra si scurisce: resta in luce solo il riquadro dell'elemento. */
  .hole {
    position: absolute;
    border-radius: 10px;
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--focus) 70%, white),
      0 0 0 9999px rgb(15 20 30 / 0.45);
    transition:
      left 260ms var(--ease),
      top 260ms var(--ease),
      width 260ms var(--ease),
      height 260ms var(--ease);
    pointer-events: none;
  }
  .card {
    position: absolute;
    max-height: calc(100vh - 32px);
    overflow: auto;
    padding: 14px 18px 14px;
    background: var(--raised);
    color: var(--ink);
    border: 1px solid var(--rule);
    border-radius: var(--radius-l);
    box-shadow: var(--shadow);
    outline: none;
    transition:
      left 260ms var(--ease),
      top 260ms var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--rubric);
    letter-spacing: 0.02em;
  }
  .count {
    margin-left: auto;
    font-size: 12px;
    color: var(--ink-3);
  }
  h2 {
    margin: 4px 0 8px;
    font-family: var(--font);
    font-size: 22px;
    font-weight: 600;
    line-height: 1.2;
  }
  .lead {
    margin: 0 0 10px;
    font-size: 14px;
    line-height: 1.55;
  }
  h3 {
    margin: 12px 0 5px;
    font-size: 11.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3);
  }
  ul {
    margin: 0;
    padding-left: 18px;
    font-size: 13.5px;
    line-height: 1.5;
  }
  li + li {
    margin-top: 4px;
  }
  .inside {
    margin: 0;
    padding: 8px 10px;
    border-left: 2px solid var(--rubric-line);
    background: var(--chrome);
    border-radius: 0 6px 6px 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink-2);
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
  }
  .dots {
    display: flex;
    gap: 5px;
    margin-right: auto;
  }
  .dot {
    width: 7px;
    height: 7px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--rule);
    cursor: pointer;
  }
  .dot.on {
    background: var(--rubric);
  }
  .btn :global(svg) {
    margin: 0 2px;
  }
</style>
