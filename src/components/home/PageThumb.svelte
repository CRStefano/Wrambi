<script lang="ts">
  import { loadThumb, type Thumb } from '../../lib/thumbs';
  import { t } from '../../lib/i18n';

  let {
    path,
    draftId,
    ext,
    modified,
    title,
  }: { path: string | null; draftId?: string; ext: string; modified: number | null; title: string } = $props();

  let thumb = $state<Thumb | null>(null);
  let el: HTMLDivElement;
  let seen = $state(false);

  // L'anteprima si prepara solo quando la pagina sta per entrare in vista.
  $effect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          seen = true;
          io.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  });

  $effect(() => {
    if (!seen) return;
    const src = { path, draftId, ext, modified };
    let alive = true;
    void loadThumb(src).then((t) => {
      if (alive) thumb = t;
    });
    return () => {
      alive = false;
    };
  });

  /** Copertina tipografica per gli EPUB senza immagine: un colore stabile per titolo. */
  const TONES = ['#33415c', '#5b2a34', '#2f4a3a', '#5a4a2a', '#3e3553', '#2c4a52'];
  function tone(s: string) {
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return TONES[h % TONES.length];
  }
</script>

<div class="thumb" bind:this={el} class:image={thumb?.kind === 'image'}>
  {#if thumb?.kind === 'image'}
    <img src={thumb.url} alt="" draggable="false" />
  {:else if thumb?.kind === 'cover'}
    <div class="cover" style="--tone: {tone(thumb.title || title)}">
      <span class="c-title">{thumb.title || title}</span>
      {#if thumb.author}<span class="c-author">{thumb.author}</span>{/if}
    </div>
  {:else if thumb?.kind === 'text'}
    <div class="sheet-text">
      {#if !thumb.lines.length}
        <p class="empty-page">{title}</p>
      {/if}
      {#each thumb.lines as l, i (i)}
        {#if l.level >= 1 && l.level <= 3}
          <p class="h h{l.level}">{l.text}</p>
        {:else if l.level === 4}
          <p class="li">{l.text}</p>
        {:else}
          <p>{l.text}</p>
        {/if}
      {/each}
    </div>
  {:else if thumb?.kind === 'none'}
    <div class="sheet-text"><p class="h h2">{title}</p><p class="faint">{t('Anteprima non disponibile')}</p></div>
  {/if}
</div>

<style>
  .thumb {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--sheet);
  }
  .thumb.image {
    background: #fff;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
  }
  .sheet-text {
    height: 100%;
    padding: 15% 13% 0;
    text-align: left;
    /* Il fondo del foglio sfuma: l'etichetta del formato resta leggibile. */
    -webkit-mask-image: linear-gradient(to bottom, #000 74%, transparent 92%);
    mask-image: linear-gradient(to bottom, #000 74%, transparent 92%);
    font-family: var(--font);
    color: var(--ink-2);
    font-size: 8.5px;
    line-height: 1.5;
  }
  .sheet-text p {
    margin: 0 0 0.7em;
    overflow-wrap: anywhere;
  }
  .h {
    color: var(--ink);
    font-weight: 650;
    line-height: 1.25;
  }
  .h1 {
    font-size: 13px;
    margin-bottom: 0.6em !important;
  }
  .h2 {
    font-size: 11px;
  }
  .h3 {
    font-size: 9.5px;
  }
  .li {
    padding-left: 1.1em;
    text-indent: -0.8em;
    margin-bottom: 0.3em !important;
  }
  .li::before {
    content: '•';
    display: inline-block;
    width: 0.8em;
    text-indent: 0;
    color: var(--ink-3);
  }
  .empty-page {
    color: var(--ink-3);
  }
  .faint {
    color: var(--ink-3);
    font-family: var(--ui);
  }
  .cover {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 10px;
    padding: 18% 14%;
    background: var(--tone);
    color: #f6f2ea;
    text-align: center;
    font-family: var(--font);
  }
  .cover::before {
    content: '';
    position: absolute;
    inset: 7%;
    border: 1px solid rgba(246, 242, 234, 0.35);
  }
  .c-title {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.25;
  }
  .c-author {
    font-size: 10px;
    font-style: italic;
    opacity: 0.85;
  }
</style>
