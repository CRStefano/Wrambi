/**
 * Livello di testo sopra una pagina PDF disegnata: il testo invisibile ma
 * selezionabile di pdf.js, e i rettangoli delle note e delle evidenziazioni.
 */
import { TextLayer, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { isTextItem, pageItems } from './pdf';
import { pageText, type PageText } from './textmap';

export interface RenderedText {
  layer: TextLayer;
  /** Un elemento per frammento di testo, nello stesso ordine di `text`. */
  divs: HTMLElement[];
  index: Map<Element, number>;
  text: PageText;
  strs: string[];
}

/** Disegna il livello di testo di una pagina dentro `container` (che ne prende le misure). */
export async function renderTextLayer(page: PDFPageProxy, container: HTMLElement, scale: number, rotation = 0): Promise<RenderedText> {
  container.replaceChildren();
  container.style.setProperty('--total-scale-factor', String(scale));
  container.style.setProperty('--scale-round-x', '1px');
  container.style.setProperty('--scale-round-y', '1px');
  const content = await page.getTextContent();
  const items = content.items.filter(isTextItem);
  const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
  const layer = new TextLayer({ textContentSource: content, container, viewport });
  await layer.render();
  const end = document.createElement('div');
  end.className = 'endOfContent';
  container.append(end);
  trackSelection(container, end);
  const divs = layer.textDivs as HTMLElement[];
  const index = new Map<Element, number>();
  divs.forEach((d, i) => index.set(d, i));
  return { layer, divs, index, text: pageText(pageItems(page, items)), strs: items.map((i) => i.str) };
}

/** Primo carattere ridotto che sta in (frammento, carattere) o dopo. */
function normAt(t: PageText, item: number, ch: number): number {
  let k = item < t.itemStart.length ? t.itemStart[item] : t.norm.length;
  while (k < t.norm.length && t.item[k] === item && t.ch[k] < ch) k++;
  return k;
}

/** Frammento (indice) che contiene un nodo del livello di testo. */
function itemOf(r: RenderedText, node: Node): number | null {
  let el: Node | null = node;
  while (el && !(el instanceof Element && r.index.has(el))) {
    if (el instanceof Element && el.classList.contains('textLayer')) return null;
    el = el.parentNode;
  }
  return el ? r.index.get(el as Element)! : null;
}

/**
 * Da un punto di una selezione (nodo, scarto) alla posizione nel testo
 * ridotto della pagina. `edge` dice se è l'inizio o la fine della selezione.
 */
export function selectionPoint(r: RenderedText, root: HTMLElement, node: Node, offset: number, edge: 'start' | 'end'): number | null {
  if (!root.contains(node)) return null;
  // La selezione può finire sull'elemento «fine del contenuto»: vale la fine del frammento prima.
  if (node instanceof Element && node.classList.contains('endOfContent')) {
    let prev = node.previousSibling;
    while (prev && !(prev instanceof Element && r.index.has(prev))) prev = prev.previousSibling;
    return prev ? normAt(r.text, r.index.get(prev as Element)! + 1, 0) : 0;
  }
  if (node === root) {
    // Selezione appoggiata al contenitore: si guarda il figlio indicato.
    const child = root.childNodes[Math.min(offset, root.childNodes.length - 1)];
    if (!child) return edge === 'start' ? 0 : r.text.norm.length;
    const item = itemOf(r, child.firstChild ?? child);
    if (item == null) return edge === 'start' ? 0 : r.text.norm.length;
    return normAt(r.text, offset >= root.childNodes.length ? item + 1 : item, 0);
  }
  const item = itemOf(r, node);
  if (item == null) return null;
  if (node.nodeType === Node.TEXT_NODE) return normAt(r.text, item, offset);
  // Nodo elemento (lo span stesso): scarto in figli, 0 = inizio.
  return normAt(r.text, offset > 0 ? item + 1 : item, 0);
}

/** Rettangoli (in pixel, rispetto a `origin`) di un tratto di testo ridotto della pagina. */
export function textRects(r: RenderedText, from: number, to: number, origin: DOMRect): DOMRect[] {
  const t = r.text;
  if (to <= from || from >= t.norm.length) return [];
  to = Math.min(to, t.norm.length);
  const a = t.item[from];
  const b = t.item[to - 1];
  const startNode = r.divs[a]?.firstChild;
  const endNode = r.divs[b]?.firstChild;
  if (!startNode || !endNode) return [];
  const endCh = t.ch[to - 1];
  const s = r.strs[b] ?? '';
  const endOff = Math.min(s.length, endCh + ((s.codePointAt(endCh) ?? 0) > 0xffff ? 2 : 1));
  const range = document.createRange();
  try {
    range.setStart(startNode, Math.min(t.ch[from], startNode.textContent?.length ?? 0));
    range.setEnd(endNode, Math.min(endOff, endNode.textContent?.length ?? 0));
  } catch {
    return [];
  }
  const out: DOMRect[] = [];
  for (const rect of range.getClientRects()) {
    if (rect.width < 1 || rect.height < 1) continue;
    out.push(new DOMRect(rect.left - origin.left, rect.top - origin.top, rect.width, rect.height));
  }
  return mergeRects(out);
}

/** Unisce i rettangoli vicini sulla stessa riga. */
function mergeRects(rects: DOMRect[]): DOMRect[] {
  rects.sort((p, q) => p.top - q.top || p.left - q.left);
  const out: DOMRect[] = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.top - r.top) < r.height * 0.5 && r.left <= last.right + r.height * 0.6) {
      const left = Math.min(last.left, r.left);
      const top = Math.min(last.top, r.top);
      const right = Math.max(last.right, r.right);
      const bottom = Math.max(last.bottom, r.bottom);
      out[out.length - 1] = new DOMRect(left, top, right - left, bottom - top);
    } else out.push(r);
  }
  return out;
}

/** Tratto del testo ridotto della pagina: verifica e, se serve, ricerca vicino a `from`. */
export function confirmSpan(t: PageText, quote: string, from: number, to: number): [number, number] | null {
  if (t.norm.slice(from, to) === quote) return [from, to];
  if (!quote) return null;
  let best = -1;
  let dist = Infinity;
  let i = t.norm.indexOf(quote);
  while (i !== -1) {
    if (Math.abs(i - from) < dist) {
      dist = Math.abs(i - from);
      best = i;
    }
    i = t.norm.indexOf(quote, i + 1);
  }
  return best >= 0 ? [best, best + quote.length] : null;
}

/* ─────────────── Selezione col mouse (come nel visore di pdf.js) ───────────────
 * Tra un frammento e l'altro c'è spazio vuoto: trascinandoci sopra alcuni
 * motori (WebKit) estendono la selezione all'inizio della pagina. pdf.js lo
 * evita con un elemento «fine del contenuto» che, durante la selezione, copre
 * la pagina e viene spostato accanto al punto in cui la selezione finisce.
 */

const tracked = new Map<HTMLElement, HTMLElement>();
const bound = new WeakSet<HTMLElement>();
let listening = false;

function trackSelection(div: HTMLElement, end: HTMLElement) {
  tracked.set(div, end);
  if (!bound.has(div)) {
    bound.add(div);
    div.addEventListener('mousedown', () => div.classList.add('selecting'));
  }
  if (listening) return;
  listening = true;
  const reset = (end: HTMLElement, layer: HTMLElement) => {
    layer.append(end);
    end.style.width = '';
    end.style.height = '';
    layer.classList.remove('selecting');
  };
  const resetAll = () => {
    for (const [layer, end] of tracked) {
      if (!layer.isConnected) tracked.delete(layer);
      else reset(end, layer);
    }
  };
  let pointerDown = false;
  let prevRange: Range | null = null;
  document.addEventListener('pointerdown', () => (pointerDown = true));
  document.addEventListener('pointerup', () => {
    pointerDown = false;
    resetAll();
  });
  window.addEventListener('blur', () => {
    pointerDown = false;
    resetAll();
  });
  document.addEventListener('keyup', () => {
    if (!pointerDown) resetAll();
  });
  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) {
      resetAll();
      return;
    }
    const range = sel.getRangeAt(0);
    for (const [layer, end] of tracked) {
      if (!layer.isConnected) tracked.delete(layer);
      else if (range.intersectsNode(layer)) layer.classList.add('selecting');
      else reset(end, layer);
    }
    const modifyStart =
      !!prevRange && (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
    let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
    if (anchor?.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
    if (!modifyStart && range.endOffset === 0 && anchor) {
      do {
        while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
        anchor = anchor?.previousSibling ?? null;
      } while (anchor && !anchor.childNodes.length);
    }
    const layer = (anchor as Element | null)?.parentElement?.closest<HTMLElement>('.textLayer');
    const end = layer ? tracked.get(layer) : undefined;
    if (layer && end && anchor?.parentElement) {
      end.style.width = layer.style.width;
      end.style.height = layer.style.height;
      anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
    }
    prevRange = range.cloneRange();
  });
}
