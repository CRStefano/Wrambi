<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
  import type { PagePoint } from '../lib/reader/textmap';
  import type { PageMark, PageSelection } from '../lib/reader/sync.svelte';
  import { confirmSpan, renderTextLayer, selectionPoint, textRects, type RenderedText } from '../lib/reader/textlayer';
  import { t } from '../lib/i18n';

  let {
    pdf,
    docKey = '',
    maxWidth = 900,
    textLayer = false,
    marks = [],
    start = null,
    onscrollpoint,
    onselection,
    onmark,
    onmarkcontext,
    onpointclick,
  }: {
    pdf: PDFDocumentProxy;
    docKey?: string;
    maxWidth?: number;
    /** Testo selezionabile sopra le pagine (per annotare). */
    textLayer?: boolean;
    /** Note ed evidenziazioni da disegnare sulle pagine. */
    marks?: PageMark[];
    /** Punto da mostrare all'apertura. */
    start?: PagePoint | null;
    onscrollpoint?: (pt: PagePoint) => void;
    onselection?: (sel: PageSelection | null) => void;
    onmark?: (id: string, rect: DOMRect) => void;
    onmarkcontext?: (id: string, x: number, y: number) => void;
    onpointclick?: (pt: PagePoint) => void;
  } = $props();

  const PAD = 28;
  const GAP = 22;
  /** Il punto di lettura sta poco sotto il bordo superiore, come nell'editor. */
  const ANCHOR = 40;

  let container: HTMLDivElement;
  let width = $state(800);
  /** Proporzioni delle pagine (altezza / larghezza), girate come vanno mostrate. */
  let ratios = $state<number[]>([]);
  let ready = false;
  let pending: { pt: PagePoint; smooth: boolean } | null = null;
  let ignoreUntil = 0;
  let flashing = $state<string | null>(null);

  const heights = $derived(ratios.map((r) => Math.round(width * r)));
  const tops = $derived.by(() => {
    const out: number[] = [];
    let y = PAD;
    for (const h of heights) {
      out.push(y);
      y += h + GAP;
    }
    return out;
  });

  /* ───────────── Posizione ───────────── */

  /** Punto delle pagine all'altezza di lettura. */
  export function currentPoint(): PagePoint | null {
    if (!container || !tops.length) return null;
    const y = container.scrollTop + ANCHOR;
    let lo = 0;
    let hi = tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tops[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    const h = heights[lo] || 1;
    return { page: lo, top: Math.min(1, Math.max(0, (y - tops[lo]) / h)) };
  }

  /** Porta il punto all'altezza di lettura. */
  export function scrollToPoint(pt: PagePoint, opts: { smooth?: boolean } = {}) {
    if (!ready || !container || pt.page >= tops.length) {
      pending = { pt, smooth: !!opts.smooth };
      return;
    }
    const y = tops[pt.page] + pt.top * heights[pt.page] - ANCHOR;
    ignoreUntil = performance.now() + (opts.smooth ? 700 : 120);
    if (opts.smooth) container.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    else container.scrollTop = Math.max(0, y);
  }

  /** Fa lampeggiare una nota sulle pagine. */
  export function flashMark(id: string) {
    flashing = id;
    setTimeout(() => {
      if (flashing === id) flashing = null;
    }, 1600);
  }

  function flushPending() {
    if (!pending || !ready) return;
    const p = pending;
    pending = null;
    scrollToPoint(p.pt, { smooth: p.smooth });
  }

  /** Esegue `change` restando nello stesso punto (cambi di larghezza o di misure delle pagine). */
  async function keepingPoint(change: () => void) {
    const pt = ready ? currentPoint() : null;
    change();
    await tick();
    if (pt) scrollToPoint(pt);
  }

  /* ───────────── Misure delle pagine ───────────── */

  let shownDoc = '';
  let sizeRun = 0;

  $effect(() => {
    const doc = pdf;
    const key = docKey;
    const run = ++sizeRun;
    const sameDoc = key === shownDoc && untrack(() => ratios.length) > 0;
    (async () => {
      const ratioOf = async (n: number) => {
        const p = await doc.getPage(n);
        const vp = p.getViewport({ scale: 1 });
        return vp.height / vp.width;
      };
      const first = await ratioOf(1);
      if (run !== sizeRun) return;
      const initial = Array.from({ length: doc.numPages }, () => first);
      if (sameDoc) {
        // Stesso documento ricompilato (anteprima): si resta dove si era.
        await keepingPoint(() => (ratios = initial));
      } else {
        shownDoc = key;
        ready = false;
        layers.clear();
        rects = {};
        ratios = initial;
        await tick();
        container.scrollTop = 0;
        ready = true;
        if (start && !pending) pending = { pt: start, smooth: false };
        flushPending();
      }
      ready = true;
      // Le altre pagine possono avere misure diverse: si correggono, a gruppi.
      const all = [...initial];
      let changed = false;
      for (let n = 2; n <= doc.numPages; n++) {
        const r = await ratioOf(n).catch(() => first);
        if (run !== sizeRun) return;
        if (Math.abs(r - all[n - 1]) > 0.001) {
          all[n - 1] = r;
          changed = true;
        }
        if (changed && (n % 40 === 0 || n === doc.numPages)) {
          const next = [...all];
          await keepingPoint(() => (ratios = next));
          changed = false;
        }
      }
      flushPending();
    })();
  });

  onMount(() => {
    const ro = new ResizeObserver(() => {
      const next = Math.min(maxWidth, Math.max(280, container.clientWidth - 48));
      if (next !== width) void keepingPoint(() => (width = next));
    });
    ro.observe(container);
    width = Math.min(maxWidth, Math.max(280, container.clientWidth - 48));
    return () => ro.disconnect();
  });

  function onScroll() {
    if (performance.now() < ignoreUntil || !ready) return;
    const pt = currentPoint();
    if (pt) onscrollpoint?.(pt);
  }

  /* ───────────── Disegno ───────────── */

  /** Livelli di testo disegnati, per pagina (da 0). */
  const layers = new Map<number, { r: RenderedText; el: HTMLElement; width: number }>();
  /** Rettangoli dei segni, per pagina. */
  let rects = $state<Record<number, { id: string; kind: string; n?: number; boxes: DOMRect[] }[]>>({});

  /** Disegna una pagina quando entra in vista, alla risoluzione dello schermo (senza lampi bianchi). */
  function page(canvas: HTMLCanvasElement, params: { n: number; w: number; pdf: PDFDocumentProxy }) {
    let { n, w, pdf: doc } = params;
    const layerEl = () => canvas.parentElement?.querySelector<HTMLElement>('.textLayer') ?? null;
    let lastPage: PDFPageProxy | null = null;
    let lastScale = 0;
    let task: RenderTask | null = null;
    let drawnKey = '';
    let visible = false;
    let busy = false;
    let again = false;

    async function draw() {
      if (!visible) return;
      const dpr = window.devicePixelRatio || 1;
      const key = `${w}@${dpr}`;
      if (drawnKey === key && drawnDoc === doc) {
        if (textLayer && lastPage) await drawLayer(lastPage, lastScale);
        return;
      }
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      const target = doc;
      const width = w;
      try {
        const p: PDFPageProxy = await target.getPage(n);
        const base = p.getViewport({ scale: 1 });
        const scale = width / base.width;
        const vp = p.getViewport({ scale: scale * dpr });
        const off = document.createElement('canvas');
        off.width = Math.floor(vp.width);
        off.height = Math.floor(vp.height);
        task = p.render({ canvas: off, viewport: vp });
        await task.promise;
        if (target !== doc || width !== w) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext('2d')?.drawImage(off, 0, 0);
        drawnKey = key;
        drawnDoc = target;
        lastPage = p;
        lastScale = scale;
        if (textLayer) await drawLayer(p, scale);
      } catch {
        /* disegno annullato o pagina illeggibile */
      } finally {
        busy = false;
        if (again) {
          again = false;
          void draw();
        }
      }
    }
    let drawnDoc: PDFDocumentProxy | null = null;

    async function drawLayer(p: PDFPageProxy, scale: number) {
      const i = n - 1;
      const el = layerEl();
      const have = layers.get(i);
      if (!el || (have && have.width === w && have.el === el)) return;
      const r = await renderTextLayer(p, el, scale);
      layers.set(i, { r, el, width: w });
      placeMarks(i);
    }

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) void draw();
      },
      { root: container, rootMargin: '900px 0px' },
    );
    io.observe(canvas);

    return {
      update(next: { n: number; w: number; pdf: PDFDocumentProxy }) {
        const changedDoc = next.pdf !== doc;
        n = next.n;
        w = next.w;
        doc = next.pdf;
        if (changedDoc) layers.delete(n - 1);
        void draw();
      },
      destroy() {
        io.disconnect();
        task?.cancel();
        layers.delete(n - 1);
      },
    };
  }

  /* ───────────── Note ed evidenziazioni ───────────── */

  const figures: HTMLElement[] = [];

  function placeMarks(i: number) {
    const have = layers.get(i);
    const fig = figures[i];
    if (!have || !fig) return;
    const origin = fig.getBoundingClientRect();
    const list: { id: string; kind: string; n?: number; boxes: DOMRect[] }[] = [];
    for (const m of marks) {
      if (m.page !== i) continue;
      const span = confirmSpan(have.r.text, m.quote, m.from, m.to);
      if (!span) continue;
      const boxes = textRects(have.r, span[0], span[1], origin);
      if (boxes.length) list.push({ id: m.id, kind: m.kind, n: m.n, boxes });
    }
    rects[i] = list;
  }

  // Segni da ridisegnare quando cambiano le note.
  $effect(() => {
    void marks;
    for (const i of layers.keys()) placeMarks(i);
  });

  function markAt(i: number, x: number, y: number) {
    for (const m of rects[i] ?? []) for (const b of m.boxes) if (x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 3) return { m, b };
    return null;
  }

  function figureIndex(el: Element | null): number {
    const fig = el?.closest<HTMLElement>('.pdf-page');
    return fig ? Number(fig.dataset.index) : -1;
  }

  let downAt: [number, number] | null = null;

  function onPointerDown(e: PointerEvent) {
    downAt = [e.clientX, e.clientY];
  }

  function onPointerUp(e: PointerEvent) {
    const moved = downAt ? Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) : 0;
    downAt = null;
    if (e.button !== 0) return;
    const sel = window.getSelection();
    if (textLayer && sel && !sel.isCollapsed && sel.rangeCount) {
      setTimeout(reportSelection, 0);
      return;
    }
    if (moved > 4) return;
    const i = figureIndex(e.target as Element);
    if (i < 0) return;
    const fig = figures[i];
    const box = fig.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const hit = markAt(i, x, y);
    if (hit) {
      onmark?.(hit.m.id, new DOMRect(box.left + hit.b.left, box.top + hit.b.top, hit.b.width, hit.b.height));
      return;
    }
    onpointclick?.({ page: i, top: Math.min(1, Math.max(0, y / box.height)) });
  }

  function onContextMenu(e: MouseEvent) {
    const i = figureIndex(e.target as Element);
    if (i < 0) return;
    const box = figures[i].getBoundingClientRect();
    const hit = markAt(i, e.clientX - box.left, e.clientY - box.top);
    if (hit && onmarkcontext) {
      e.preventDefault();
      onmarkcontext(hit.m.id, e.clientX, e.clientY);
    }
  }

  /** Selezione nel testo delle pagine → inizio e fine nel testo ridotto delle pagine. */
  function reportSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      onselection?.(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const a = figureIndex(range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement);
    const b = figureIndex(range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement);
    if (a < 0 || b < 0) {
      onselection?.(null);
      return;
    }
    const la = layers.get(a);
    const lb = layers.get(b);
    if (!la || !lb) return;
    const s = selectionPoint(la.r, la.el, range.startContainer, range.startOffset, 'start');
    const t = selectionPoint(lb.r, lb.el, range.endContainer, range.endOffset, 'end');
    if (s == null || t == null || (a === b && t <= s)) {
      onselection?.(null);
      return;
    }
    onselection?.({ startPage: a, startAt: s, endPage: b, endAt: t, rect: range.getBoundingClientRect() });
  }

  onMount(() => {
    if (!textLayer) return;
    const onChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) onselection?.(null);
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  });

</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pages" bind:this={container} onscroll={onScroll} onpointerdown={onPointerDown} onpointerup={onPointerUp} oncontextmenu={onContextMenu}>
  <div class="stack" style="height:{tops.length ? tops[tops.length - 1] + heights[heights.length - 1] + 80 : 0}px">
    {#each ratios as _, i (i)}
      <figure class="pdf-page" bind:this={figures[i]} data-index={i} style="top:{tops[i]}px;width:{width}px;height:{heights[i]}px">
        <canvas use:page={{ n: i + 1, w: width, pdf }} style="width:{width}px;height:{heights[i]}px" aria-label={t('Pagina {n}', { n: i + 1 })}></canvas>
        {#if rects[i]?.length}
          <div class="pdf-marks" aria-hidden="true">
            {#each rects[i] as m (m.id)}
              {#each m.boxes as b, j (j)}
                <span class="pdf-mark {m.kind}" class:flash={flashing === m.id} data-id={m.id} style="left:{b.left}px;top:{b.top}px;width:{b.width}px;height:{b.height}px"></span>
              {/each}
              {#if m.n}
                {@const last = m.boxes[m.boxes.length - 1]}
                <sup class="pdf-mark-num" style="left:{last.right + 1}px;top:{last.top - 4}px">{m.n}</sup>
              {/if}
            {/each}
          </div>
        {/if}
        {#if textLayer}
          <div class="textLayer"></div>
        {/if}
        <figcaption>{i + 1}</figcaption>
      </figure>
    {/each}
  </div>
</div>

<style>
  .pages {
    height: 100%;
    background: var(--chrome);
    overflow-y: auto;
    overflow-x: hidden;
    overflow-anchor: none;
  }
  .stack {
    position: relative;
  }
  .pdf-page {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
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
