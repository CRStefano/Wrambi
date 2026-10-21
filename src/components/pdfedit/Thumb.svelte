<script lang="ts">
  import { onMount } from 'svelte';
  import type { RenderTask } from 'pdfjs-dist';
  import type { PageRef } from '../../lib/pdfedit/model';
  import { sourcePdf } from '../../lib/pdfedit/session.svelte';

  let { ref, width = 120 }: { ref: PageRef; width?: number } = $props();

  let canvas: HTMLCanvasElement;
  let visible = $state(false);
  let size = $state<[number, number]>([120, 170]);

  onMount(() => {
    const io = new IntersectionObserver((e) => (visible = e.some((x) => x.isIntersecting)), { rootMargin: '400px 0px' });
    io.observe(canvas);
    return () => io.disconnect();
  });

  $effect(() => {
    const r = ref.rotate;
    const src = ref.src;
    const index = ref.index;
    if (!visible) return;
    let task: RenderTask | null = null;
    let alive = true;
    const dpr = window.devicePixelRatio || 1;
    (async () => {
      const pdf = src >= 0 ? sourcePdf(src) : null;
      if (!pdf) {
        const [w, h] = ref.size ?? [595, 842];
        const rot = r % 180 !== 0;
        const next: [number, number] = [width, (width * (rot ? w : h)) / (rot ? h : w)];
        size = next;
        canvas.width = Math.round(next[0] * dpr);
        canvas.height = Math.round(next[1] * dpr);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
      }
      const page = await pdf.getPage(index + 1);
      if (!alive) return;
      const rotation = (page.rotate + r) % 360;
      const base = page.getViewport({ scale: 1, rotation });
      const vp = page.getViewport({ scale: (width / base.width) * dpr, rotation });
      size = [width, (width * base.height) / base.width];
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      task = page.render({ canvas, viewport: vp });
      await task.promise.catch(() => {});
    })();
    return () => {
      alive = false;
      task?.cancel();
    };
  });
</script>

<canvas bind:this={canvas} style="width:{size[0]}px;height:{size[1]}px"></canvas>

<style>
  canvas {
    display: block;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.18);
  }
</style>
