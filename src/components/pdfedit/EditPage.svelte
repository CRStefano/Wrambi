<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';
  import { t } from '../../lib/i18n';
  import {
    CSS_FAMILY,
    View,
    corners,
    cssColor,
    groupLines,
    lineBox,
    lineRoom,
    matchFont,
    sampleColors,
    textWidth,
    type Box,
    type FontSpec,
    type Op,
    type PageRef,
    type RGB,
    type RawItem,
    type TextLine,
  } from '../../lib/pdfedit/model';
  import { addOp, checkpoint, images, newId, pdfEdit, removeOp, sourcePdf, updateOp } from '../../lib/pdfedit/session.svelte';
  import { annotateSelection, type PageMark } from '../../lib/reader/sync.svelte';
  import { confirmSpan, renderTextLayer, selectionPoint, textRects, type RenderedText } from '../../lib/reader/textlayer';
  import { popoverPlacement } from '../../lib/actions';
  import { editorNoteMenu } from '../../lib/notes/manage';
  import { ui } from '../../lib/state.svelte';

  let { ref, width, number, marks = [] }: { ref: PageRef; width: number; number: number; marks?: PageMark[] } = $props();

  /* ───────────── Note di Wrambi sulla pagina (testo selezionabile con lo strumento Nota) ───────────── */

  let layerEl: HTMLDivElement | undefined = $state();
  let layer: RenderedText | null = null;
  let layerKey = '';
  let markRects = $state<{ id: string; kind: string; n?: number; boxes: DOMRect[] }[]>([]);

  async function drawLayer() {
    if (!page || ref.src !== 0 || !layerEl) return;
    const key = `${view.scale}:${rotation}`;
    if (key === layerKey) return;
    layerKey = key;
    layer = await renderTextLayer(page, layerEl, view.scale, ref.rotate);
    placeMarks();
  }

  function placeMarks() {
    if (!layer || !host) {
      markRects = [];
      return;
    }
    const origin = host.getBoundingClientRect();
    const out: typeof markRects = [];
    for (const m of marks) {
      const span = confirmSpan(layer.text, m.quote, m.from, m.to);
      if (!span) continue;
      const boxes = textRects(layer, span[0], span[1], origin);
      if (boxes.length) out.push({ id: m.id, kind: m.kind, n: m.n, boxes });
    }
    markRects = out;
  }

  $effect(() => {
    void marks;
    placeMarks();
  });

  /** Fine di una selezione con lo strumento Nota: si apre il riquadro della nota. */
  function noteFromSelection() {
    const sel = window.getSelection();
    if (!layer || !layerEl || !sel || sel.isCollapsed || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    if (!layerEl.contains(range.startContainer) || !layerEl.contains(range.endContainer)) return false;
    const a = selectionPoint(layer, layerEl, range.startContainer, range.startOffset, 'start');
    const b = selectionPoint(layer, layerEl, range.endContainer, range.endOffset, 'end');
    if (a == null || b == null || b <= a) return false;
    annotateSelection('note', { startPage: ref.index, startAt: a, endPage: ref.index, endAt: b, rect: range.getBoundingClientRect() });
    return true;
  }

  function markAt(e: MouseEvent) {
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    for (const m of markRects) for (const b of m.boxes) if (x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 3) return { m, rect: new DOMRect(r.left + b.left, r.top + b.top, b.width, b.height) };
    return null;
  }

  let canvas: HTMLCanvasElement;
  let host: HTMLDivElement;
  let page = $state.raw<PDFPageProxy | null>(null);
  let lines = $state.raw<TextLine[]>([]);
  let fonts = new Map<string, FontSpec>();
  let visible = $state(false);
  let rendered = '';
  let task: RenderTask | null = null;
  let input: HTMLInputElement | undefined = $state();

  /** Riquadro del documento: quello della pagina PDF o della pagina vuota. */
  const viewBox = $derived<[number, number, number, number]>(
    page ? (page.view as [number, number, number, number]) : [0, 0, ref.size?.[0] ?? 595, ref.size?.[1] ?? 842],
  );
  const rotation = $derived((((page?.rotate ?? 0) + ref.rotate) % 360 + 360) % 360);
  const view = $derived.by(() => {
    const [x0, y0, x1, y1] = viewBox;
    const across = rotation % 180 ? y1 - y0 : x1 - x0;
    return new View(viewBox, width / across, rotation);
  });
  const ops = $derived(pdfEdit.ops.filter((o) => o.page === ref.id));
  const replacedLines = $derived(new Set(ops.filter((o) => o.kind === 'replace').map((o) => (o as { lineId: string }).lineId)));

  onMount(() => {
    const io = new IntersectionObserver((e) => (visible = e.some((x) => x.isIntersecting)), { rootMargin: '900px 0px' });
    io.observe(host);
    return () => {
      io.disconnect();
      task?.cancel();
    };
  });

  // Pagina pdf.js (le pagine vuote non ne hanno).
  $effect(() => {
    const pdf = ref.src >= 0 ? sourcePdf(ref.src) : null;
    if (!pdf) {
      page = null;
      return;
    }
    let alive = true;
    void pdf.getPage(ref.index + 1).then((p) => {
      if (alive) page = p;
    });
    return () => {
      alive = false;
    };
  });

  // Disegno della pagina alla risoluzione dello schermo, quando è in vista.
  $effect(() => {
    const v = view;
    const p = page;
    if (!visible || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const key = `${v.width}x${v.height}@${dpr}:${rotation}:${p ? 'p' : 'blank'}`;
    if (key === rendered) return;
    canvas.width = Math.floor(v.width * dpr);
    canvas.height = Math.floor(v.height * dpr);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    if (!p) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      rendered = key;
      return;
    }
    task?.cancel();
    const vp = p.getViewport({ scale: v.scale * dpr, rotation });
    task = p.render({ canvas, viewport: vp });
    task.promise.then(
      () => {
        rendered = key;
        void loadLines();
        void drawLayer();
      },
      () => {},
    );
  });

  /** Righe di testo e caratteri della pagina (dopo il disegno, quando i font sono caricati). */
  async function loadLines() {
    if (!page || lines.length) return;
    const tc = await page.getTextContent();
    const items = tc.items.filter((i) => 'str' in i) as unknown as RawItem[];
    lines = groupLines(items, ref.id);
    fonts = new Map();
    for (const name of new Set(items.map((i) => i.fontName))) {
      let flags: { bold?: boolean; italic?: boolean; fallbackName?: string } = {};
      try {
        flags = page.commonObjs.get(name) as typeof flags;
      } catch {
        /* font non caricato: si guarda solo il nome */
      }
      const family = (tc.styles as Record<string, { fontFamily?: string }>)[name]?.fontFamily ?? flags.fallbackName;
      fonts.set(name, matchFont(name, family, flags));
    }
  }

  /* ───────────── Coordinate ───────────── */

  function local(e: PointerEvent | MouseEvent): [number, number] {
    const r = host.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Riquadro della pagina da due punti dello schermo (lati dritti sullo schermo). */
  function boxFrom(a: [number, number], b: [number, number]): Box {
    const [x0, x1] = [a[0], b[0]].sort((m, n) => m - n);
    const [y0, y1] = [a[1], b[1]].sort((m, n) => m - n);
    const [bx, by] = view.toPdf(x0, y1);
    return { x: bx, y: by, w: (x1 - x0) / view.scale, h: (y1 - y0) / view.scale, angle: view.uprightAngle() };
  }

  /* ───────────── Modifica del testo in linea ───────────── */

  type Editing = {
    opId: string | null;
    kind: 'replace' | 'text';
    line?: TextLine;
    x: number;
    y: number;
    angle: number;
    size: number;
    font: FontSpec;
    color: RGB;
    bg: RGB;
    value: string;
    width: number;
  };
  let editing = $state<Editing | null>(null);

  /** Colori di sfondo e del testo nell'area di un riquadro, dalla pagina disegnata. */
  function colorsAt(b: Box): { bg: RGB; fg: RGB } {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !rendered) return { bg: [1, 1, 1], fg: [0, 0, 0] };
    const dpr = canvas.width / view.width;
    const pts = corners(b).map(([x, y]) => view.toView(x, y));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return sampleColors(ctx, left * dpr, top * dpr, (Math.max(...xs) - left) * dpr, (Math.max(...ys) - top) * dpr);
  }

  async function editLine(line: TextLine) {
    const existing = ops.find((o) => o.kind === 'replace' && o.lineId === line.id) as Extract<Op, { kind: 'replace' }> | undefined;
    if (existing) {
      editing = { opId: existing.id, kind: 'replace', line, x: existing.x, y: existing.y, angle: existing.angle, size: existing.size, font: existing.font, color: existing.color, bg: existing.bg, value: existing.text, width: Math.max(line.width, existing.cover.w) };
    } else {
      const { bg, fg } = colorsAt(line.box);
      editing = {
        opId: null,
        kind: 'replace',
        line,
        x: line.x,
        y: line.y,
        angle: line.angle,
        size: line.size,
        font: fonts.get(line.fontName) ?? { family: 'serif', bold: false, italic: false },
        color: fg,
        bg,
        value: line.text,
        width: line.width,
      };
    }
    pdfEdit.selected = existing?.id ?? null;
    await tick();
    input?.focus();
    input?.select();
  }

  async function startText(at: [number, number]) {
    const angle = view.uprightAngle();
    const size = pdfEdit.size;
    // Il clic è l'angolo in alto a sinistra del testo: la linea di base è poco sotto.
    const [x, y] = view.toPdf(at[0], at[1] + size * view.scale * 0.95);
    editing = { opId: null, kind: 'text', x, y, angle, size, font: { ...pdfEdit.font }, color: [...pdfEdit.color] as RGB, bg: [1, 1, 1], value: '', width: size * 8 };
    await tick();
    input?.focus();
  }

  function editTextOp(op: Extract<Op, { kind: 'text' }>) {
    editing = { opId: op.id, kind: 'text', x: op.x, y: op.y, angle: op.angle, size: op.size, font: op.font, color: op.color, bg: [1, 1, 1], value: op.text, width: 0 };
    void tick().then(() => {
      input?.focus();
      input?.select();
    });
  }

  async function commit() {
    const e = editing;
    if (!e) return;
    editing = null;
    const text = e.value.replace(/\s+$/, '');
    if (e.kind === 'text') {
      if (!text.trim()) {
        if (e.opId) removeOp(e.opId);
        return;
      }
      if (e.opId) updateOp(e.opId, { text } as Partial<Op>);
      else addOp({ kind: 'text', id: newId(), page: ref.id, x: e.x, y: e.y, angle: e.angle, size: e.size, text, font: e.font, color: e.color });
      return;
    }
    const line = e.line!;
    if (!e.opId && text === line.text) return;
    // Il testo nuovo può allungarsi fino al margine della colonna; oltre, si stringe un poco il carattere.
    let size = line.size;
    let w = await textWidth(text, e.font, size);
    const room = lineRoom(line, lines);
    if (w > room * 1.01) {
      size = Math.max(line.size * 0.8, (line.size * room) / w);
      w = await textWidth(text, e.font, size);
    }
    const cover = lineBox(line.x, line.y, Math.max(line.width, w), line.size, line.angle, Math.max(0.6, line.size * 0.06));
    const patch = { text, size, cover, font: e.font, color: e.color, bg: e.bg };
    if (e.opId) updateOp(e.opId, patch as Partial<Op>);
    else addOp({ kind: 'replace', id: newId(), page: ref.id, lineId: line.id, original: line.text, x: line.x, y: line.y, angle: line.angle, ...patch });
  }

  function cancelEdit() {
    editing = null;
  }

  function onInputKey(ev: KeyboardEvent) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      void commit();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      cancelEdit();
    }
  }

  /* ───────────── Trascinamenti: evidenziare, coprire, spostare ───────────── */

  let drag = $state<{ from: [number, number]; to: [number, number] } | null>(null);
  let moving: { id: string; start: [number, number]; orig: Op; resize: boolean; checkpointed: boolean } | null = null;

  function onPointerDown(ev: PointerEvent) {
    if (ev.button !== 0) return;
    const target = ev.target as HTMLElement;
    if (target.closest('input, .op-tools')) return;
    // Strumento Nota: si seleziona il testo come in un lettore (niente modifiche alla pagina).
    if (pdfEdit.tool === 'note') {
      if (editing) void commit();
      return;
    }
    if (editing) {
      void commit();
      return;
    }
    const at = local(ev);
    const tool = pdfEdit.tool;
    const opEl = target.closest<HTMLElement>('[data-op]');
    if (opEl && (tool === 'select' || (tool !== 'highlight' && tool !== 'cover'))) {
      const id = opEl.dataset.op!;
      pdfEdit.selected = id;
      const op = pdfEdit.ops.find((o) => o.id === id);
      if (op && tool === 'select' && op.kind !== 'replace') {
        moving = { id, start: at, orig: $state.snapshot(op) as Op, resize: !!target.closest('.resize'), checkpointed: false };
        host.setPointerCapture(ev.pointerId);
      }
      ev.preventDefault();
      return;
    }
    pdfEdit.selected = null;
    if (tool === 'highlight' || tool === 'cover') {
      drag = { from: at, to: at };
      host.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    } else if (tool === 'text') {
      ev.preventDefault();
      void startText(at);
    } else if (tool === 'edit') {
      const lineEl = target.closest<HTMLElement>('[data-line]');
      const line = lineEl && lines.find((l) => l.id === lineEl.dataset.line);
      if (line) {
        ev.preventDefault();
        void editLine(line);
      }
    }
  }

  function onPointerMove(ev: PointerEvent) {
    if (drag) {
      drag.to = local(ev);
      return;
    }
    if (moving) {
      const [x, y] = local(ev);
      const [dx, dy] = [x - moving.start[0], y - moving.start[1]];
      if (!moving.checkpointed && Math.hypot(dx, dy) < 3) return;
      if (!moving.checkpointed) {
        checkpoint();
        moving.checkpointed = true;
      }
      const [px0, py0] = view.toPdf(...moving.start);
      const [px1, py1] = view.toPdf(x, y);
      const ddx = px1 - px0;
      const ddy = py1 - py0;
      const o = moving.orig;
      let patch: Partial<Op> = {};
      if (o.kind === 'text') patch = { x: o.x + ddx, y: o.y + ddy };
      else if (o.kind === 'cover' || o.kind === 'image') {
        if (moving.resize) {
          // Ridimensiona dall'angolo in basso a destra (sullo schermo).
          const w = Math.max(6, o.box.w + dx / view.scale);
          const h = o.kind === 'image' ? (w * o.box.h) / o.box.w : Math.max(4, o.box.h + dy / view.scale);
          const c = Math.cos((o.box.angle * Math.PI) / 180);
          const s = Math.sin((o.box.angle * Math.PI) / 180);
          // Il lato in alto resta fermo: il vertice in basso a sinistra scende.
          const dh = h - o.box.h;
          patch = { box: { ...o.box, w, h, x: o.box.x + dh * s, y: o.box.y - dh * c } } as Partial<Op>;
        } else patch = { box: { ...o.box, x: o.box.x + ddx, y: o.box.y + ddy } } as Partial<Op>;
      } else if (o.kind === 'highlight') patch = { boxes: o.boxes.map((b) => ({ ...b, x: b.x + ddx, y: b.y + ddy })) } as Partial<Op>;
      updateOp(moving.id, patch, false);
    }
  }

  function onPointerUp(ev: PointerEvent) {
    if (pdfEdit.tool === 'note') {
      if (ev.button !== 0) return;
      setTimeout(() => {
        if (noteFromSelection()) return;
        const hit = markAt(ev);
        if (hit) ui.popover = { noteId: hit.m.id, ...popoverPlacement(hit.rect) };
      }, 0);
      return;
    }
    if (moving) {
      moving = null;
      host.releasePointerCapture(ev.pointerId);
      return;
    }
    if (!drag) return;
    const { from, to } = drag;
    drag = null;
    host.releasePointerCapture(ev.pointerId);
    if (Math.abs(to[0] - from[0]) < 3 && Math.abs(to[1] - from[1]) < 3) {
      // Un clic sull'evidenziatore: evidenzia la riga cliccata.
      if (pdfEdit.tool === 'highlight') {
        const lineEl = document.elementsFromPoint(ev.clientX, ev.clientY).find((el) => (el as HTMLElement).dataset?.line) as HTMLElement | undefined;
        const line = lineEl && lines.find((l) => l.id === lineEl.dataset.line);
        if (line) addOp({ kind: 'highlight', id: newId(), page: ref.id, boxes: [lineBox(line.x, line.y, line.width, line.size, line.angle)], color: [...pdfEdit.highlight] as RGB });
      }
      return;
    }
    const box = boxFrom(from, to);
    if (pdfEdit.tool === 'cover') {
      const { bg } = colorsAt(box);
      addOp({ kind: 'cover', id: newId(), page: ref.id, box, color: bg });
    } else {
      addOp({ kind: 'highlight', id: newId(), page: ref.id, boxes: highlightBoxes(from, to, box), color: [...pdfEdit.highlight] as RGB });
    }
  }

  /** Evidenziazione: le righe toccate dal trascinamento, tagliate ai suoi bordi; altrimenti il rettangolo. */
  function highlightBoxes(from: [number, number], to: [number, number], fallback: Box): Box[] {
    const x0 = Math.min(from[0], to[0]);
    const x1 = Math.max(from[0], to[0]);
    const y0 = Math.min(from[1], to[1]);
    const y1 = Math.max(from[1], to[1]);
    const up = view.uprightAngle();
    const out: Box[] = [];
    for (const l of lines) {
      if (Math.abs(((l.angle - up + 540) % 360) - 180) > 2) continue;
      const css = view.css(l.box);
      const m = /matrix\(([^)]+)\)/.exec(css.transform)!;
      const [, , , , ex, ey] = m[1].split(',').map(Number);
      const top = ey;
      const bottom = ey + css.height;
      const mid = (top + bottom) / 2;
      if (mid < y0 || mid > y1) continue;
      const left = Math.max(ex, x0);
      const right = Math.min(ex + css.width, x1);
      if (right - left < 2) continue;
      const startAlong = (left - ex) / view.scale;
      const w = (right - left) / view.scale;
      const c = Math.cos((l.box.angle * Math.PI) / 180);
      const s = Math.sin((l.box.angle * Math.PI) / 180);
      out.push({ ...l.box, x: l.box.x + startAlong * c, y: l.box.y + startAlong * s, w });
    }
    return out.length ? out : [fallback];
  }

  function onDblClick(ev: MouseEvent) {
    const opEl = (ev.target as HTMLElement).closest<HTMLElement>('[data-op]');
    const op = opEl && pdfEdit.ops.find((o) => o.id === opEl.dataset.op);
    if (op?.kind === 'text') editTextOp(op);
    else if (op?.kind === 'replace') {
      const line = lines.find((l) => l.id === op.lineId);
      if (line) void editLine(line);
    }
  }

  const dragRect = $derived(
    drag
      ? {
          left: Math.min(drag.from[0], drag.to[0]),
          top: Math.min(drag.from[1], drag.to[1]),
          width: Math.abs(drag.to[0] - drag.from[0]),
          height: Math.abs(drag.to[1] - drag.from[1]),
        }
      : null,
  );

  function boxStyle(b: Box): string {
    const c = view.css(b);
    return `width:${c.width}px;height:${c.height}px;transform:${c.transform}`;
  }

  function textStyle(o: { x: number; y: number; angle: number; size: number; font: FontSpec; color: RGB }, width = 0): string {
    const b = lineBox(o.x, o.y, width, o.size, o.angle);
    const c = view.css(b);
    return `height:${c.height}px;${width ? `min-width:${c.width}px;` : ''}transform:${c.transform};font-family:${CSS_FAMILY[o.font.family]};font-weight:${o.font.bold ? 700 : 400};font-style:${o.font.italic ? 'italic' : 'normal'};font-size:${o.size * view.scale}px;line-height:${c.height}px;color:${cssColor(o.color)}`;
  }

  // Le note di Wrambi non si toccano qui: si modificano le pagine.
  const showLines = $derived(pdfEdit.tool === 'edit' || pdfEdit.tool === 'highlight');
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="page tool-{pdfEdit.tool}"
  bind:this={host}
  style="width:{view.width}px;height:{view.height}px"
  data-page={ref.id}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  ondblclick={onDblClick}
  oncontextmenu={(e) => {
    const hit = pdfEdit.tool === 'note' ? markAt(e) : null;
    if (hit) {
      e.preventDefault();
      editorNoteMenu(hit.m.id, e.clientX, e.clientY, hit.rect);
    }
  }}
>
  <canvas bind:this={canvas} style="width:{view.width}px;height:{view.height}px" aria-label={t('Pagina {n}', { n: number })}></canvas>

  {#if markRects.length}
    <div class="pdf-marks" aria-hidden="true">
      {#each markRects as m (m.id)}
        {#each m.boxes as b, j (j)}
          <span class="pdf-mark {m.kind}" style="left:{b.left}px;top:{b.top}px;width:{b.width}px;height:{b.height}px"></span>
        {/each}
        {#if m.n}
          {@const last = m.boxes[m.boxes.length - 1]}
          <sup class="pdf-mark-num" style="left:{last.right + 1}px;top:{last.top - 4}px">{m.n}</sup>
        {/if}
      {/each}
    </div>
  {/if}
  {#if ref.src === 0}
    <div class="textLayer" class:live={pdfEdit.tool === 'note'} bind:this={layerEl}></div>
  {/if}

  {#if showLines}
    <div class="lines" aria-hidden="true">
      {#each lines as l (l.id)}
        {#if !replacedLines.has(l.id) && editing?.line?.id !== l.id}
          <div class="line" data-line={l.id} style={boxStyle(l.box)} title={pdfEdit.tool === 'edit' ? t('Clic per modificare questa riga') : ''}></div>
        {/if}
      {/each}
    </div>
  {/if}

  <div class="ops">
    {#each ops as o (o.id)}
      {#if o.kind === 'cover'}
        <div class="op cover" class:sel={pdfEdit.selected === o.id} data-op={o.id} style="{boxStyle(o.box)};background:{cssColor(o.color)}">
          {#if pdfEdit.selected === o.id && pdfEdit.tool === 'select'}<span class="resize" title={t('Trascina per ridimensionare')}></span>{/if}
        </div>
      {:else if o.kind === 'highlight'}
        {#each o.boxes as b, i (i)}
          <div class="op hl" class:sel={pdfEdit.selected === o.id} data-op={o.id} style="{boxStyle(b)};background:{cssColor(o.color, 0.4)}"></div>
        {/each}
      {:else if o.kind === 'image'}
        <div class="op image" class:sel={pdfEdit.selected === o.id} data-op={o.id} style={boxStyle(o.box)}>
          <img src={images.get(o.image)?.url} alt="" draggable="false" />
          {#if pdfEdit.selected === o.id && pdfEdit.tool === 'select'}<span class="resize" title={t('Trascina per ridimensionare')}></span>{/if}
        </div>
      {:else if o.kind === 'replace'}
        {#if editing?.opId !== o.id}
          <div class="op cover" data-op={o.id} style="{boxStyle(o.cover)};background:{cssColor(o.bg)}"></div>
          <div class="op text replaced" class:sel={pdfEdit.selected === o.id} data-op={o.id} style={textStyle(o)} title={t('Doppio clic per modificare · era: «{text}»', { text: o.original })}>{o.text}</div>
        {/if}
      {:else if o.kind === 'text'}
        {#if editing?.opId !== o.id}
          <div class="op text" class:sel={pdfEdit.selected === o.id} data-op={o.id} style={textStyle(o)}>{o.text}</div>
        {/if}
      {/if}
    {/each}
  </div>

  {#if editing}
    {#if editing.kind === 'replace' && editing.line}
      <div class="op cover" style="{boxStyle(lineBox(editing.line.x, editing.line.y, editing.line.width, editing.line.size, editing.line.angle, 1))};background:{cssColor(editing.bg)}"></div>
    {/if}
    <input
      class="inline-input"
      bind:this={input}
      bind:value={editing.value}
      style={textStyle(editing, Math.max(editing.width, editing.size * 6))}
      spellcheck="true"
      onkeydown={onInputKey}
      onblur={() => void commit()}
      aria-label={editing.kind === 'replace' ? t('Testo della riga') : t('Nuovo testo')}
    />
  {/if}

  {#if dragRect}
    <div class="drag {pdfEdit.tool}" style="left:{dragRect.left}px;top:{dragRect.top}px;width:{dragRect.width}px;height:{dragRect.height}px"></div>
  {/if}
</div>

<style>
  .page {
    position: relative;
    flex: none;
    margin: 0 auto;
    background: #fff;
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.12),
      0 6px 24px rgb(0 0 0 / 0.1);
    touch-action: none;
    user-select: none;
  }
  canvas {
    display: block;
  }
  /* Il testo si seleziona solo con lo strumento Nota. */
  .page :global(.textLayer) {
    pointer-events: none;
  }
  .page :global(.textLayer.live) {
    pointer-events: auto;
  }
  .page :global(.textLayer:not(.live) span) {
    user-select: none;
    -webkit-user-select: none;
  }
  .tool-note .op {
    pointer-events: none;
  }
  .lines,
  .ops {
    position: absolute;
    inset: 0;
  }
  .ops {
    pointer-events: none;
  }
  .line,
  .op,
  .inline-input {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }
  .tool-edit .line {
    cursor: text;
  }
  .tool-edit .line:hover {
    outline: 1.5px solid color-mix(in srgb, var(--focus, #2f6fde) 70%, transparent);
    background: color-mix(in srgb, var(--focus, #2f6fde) 8%, transparent);
    border-radius: 2px;
  }
  .tool-highlight .line {
    cursor: crosshair;
  }
  .tool-highlight,
  .tool-cover {
    cursor: crosshair;
  }
  .tool-text {
    cursor: text;
  }
  .op {
    pointer-events: auto;
  }
  .tool-highlight .op,
  .tool-cover .op {
    pointer-events: none;
  }
  .op.hl {
    mix-blend-mode: multiply;
  }
  .op.text {
    white-space: pre;
    padding: 0;
  }
  .tool-select .op {
    cursor: move;
  }
  .op.replaced {
    cursor: text;
  }
  .op.image img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: fill;
  }
  .op.sel {
    outline: 1.5px dashed var(--focus, #2f6fde);
    outline-offset: 1px;
  }
  .resize {
    position: absolute;
    right: -6px;
    bottom: -6px;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: var(--focus, #2f6fde);
    border: 2px solid #fff;
    cursor: nwse-resize;
  }
  .inline-input {
    margin: 0;
    padding: 0 1px;
    border: 0;
    outline: 2px solid var(--focus, #2f6fde);
    border-radius: 2px;
    background: transparent;
    box-sizing: content-box;
    z-index: 3;
  }
  .drag {
    position: absolute;
    pointer-events: none;
    border: 1.5px dashed var(--focus, #2f6fde);
  }
  .drag.highlight {
    background: rgb(255 214 51 / 0.3);
  }
  .drag.cover {
    background: rgb(255 255 255 / 0.85);
  }
</style>
