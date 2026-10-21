<script lang="ts">
  import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

  let { pdf, docKey = '', maxWidth = 900 }: { pdf: PDFDocumentProxy; docKey?: string; maxWidth?: number } = $props();

  let container: HTMLDivElement;
  let width = $state(800);
  let ratios = $state<number[]>([]);

  // Proporzioni delle pagine (dalla prima, corrette man mano che si disegnano).
  $effect(() => {
    const doc = pdf;
    void docKey;
    let cancelled = false;
    (async () => {
      const first = await doc.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      if (!cancelled) ratios = Array.from({ length: doc.numPages }, () => vp.height / vp.width);
    })();
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const ro = new ResizeObserver(() => {
      width = Math.min(maxWidth, Math.max(280, container.clientWidth - 48));
    });
    ro.observe(container);
    return () => ro.disconnect();
  });

  /** Disegna una pagina quando entra in vista, alla risoluzione dello schermo. */
  function page(canvas: HTMLCanvasElement, params: { n: number; w: number }) {
    let { n, w: width } = params;
    let task: RenderTask | null = null;
    let drawnWidth = 0;
    let visible = false;

    async function draw() {
      const w = width;
      if (!visible || drawnWidth === w) return;
      task?.cancel();
      const p = await pdf.getPage(n);
      const base = p.getViewport({ scale: 1 });
      const scale = w / base.width;
      const dpr = window.devicePixelRatio || 1;
      const vp = p.getViewport({ scale: scale * dpr });
      const ratio = base.height / base.width;
      if (Math.abs((ratios[n - 1] ?? 0) - ratio) > 0.001) ratios[n - 1] = ratio;
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      task = p.render({ canvas, viewport: vp });
      try {
        await task.promise;
        drawnWidth = w;
      } catch {
        /* disegno annullato da uno successivo */
      }
    }

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) void draw();
      },
      { root: container, rootMargin: '800px 0px' },
    );
    io.observe(canvas);

    return {
      update(next: { n: number; w: number }) {
        n = next.n;
        width = next.w;
        void draw();
      },
      destroy() {
        io.disconnect();
        task?.cancel();
      },
    };
  }
</script>

<div class="pages" bind:this={container}>
  {#each ratios as ratio, i (docKey + ':' + i)}
    <figure class="pdf-page" style="width:{width}px;height:{Math.round(width * ratio)}px">
      <canvas use:page={{ n: i + 1, w: width }} style="width:{width}px;height:{Math.round(width * ratio)}px"></canvas>
      <figcaption>{i + 1}</figcaption>
    </figure>
  {/each}
</div>

<style>
  .pages {
    height: 100%;
    background: var(--chrome);
    overflow-y: auto;
    overflow-x: hidden;
    padding: 28px 24px 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 22px;
  }
  .pdf-page {
    position: relative;
    margin: 0;
    flex: none;
    background: #fff;
    box-shadow: var(--shadow-s);
  }
  canvas {
    display: block;
  }
  figcaption {
    position: absolute;
    bottom: -19px;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 11px;
    color: var(--ink-3);
  }
  :global([data-theme='dark']) .pdf-page {
    filter: brightness(0.92);
  }
</style>
