/**
 * EPUB: scrittura (EPUB 3 ridisponibile, con indice compatibile EPUB 2)
 * e lettura (estrazione del testo nell'ordine di lettura).
 *
 * L'EPUB esportato conserva struttura e testo; non ha impaginazione fissa:
 * è il lettore a disporre il testo sullo schermo.
 */
import { strToU8, strFromU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { parse, plain, type Block, type Doc } from './ast';
import { EmitContext, escapeHtml, htmlBlocks, htmlNotes, htmlReferences, type EmitOptions } from './emit';

const EPUB_CSS = `
body { font-family: serif; line-height: 1.55; margin: 0 5%; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 .5em; font-weight: bold; }
h1 { font-size: 1.6em; } h2 { font-size: 1.35em; } h3 { font-size: 1.15em; }
p { margin: 0 0 .8em; text-indent: 0; }
blockquote { margin: 1em 1.5em; font-style: italic; }
pre { white-space: pre-wrap; font-family: monospace; font-size: .9em; }
code { font-family: monospace; }
table { border-collapse: collapse; } th, td { border: 1px solid #999; padding: .2em .5em; }
.img-missing { font-style: italic; }
sup.fnref { line-height: 0; font-size: .75em; } sup.fnref a { text-decoration: none; }
.footnotes ol { padding-left: 1.6em; } .footnotes li p { margin: 0 0 .5em; }
.fnback { text-decoration: none; }
.references .ref { padding-left: 2em; text-indent: -2em; margin: 0 0 .6em; }
`.trim();

export interface Chapter {
  title: string;
  blocks: Block[];
}

/** Divide il documento in capitoli ai titoli di livello più alto (se almeno due). */
export function splitChapters(doc: Doc, fallbackTitle: string): Chapter[] {
  const levels = doc.blocks.filter((b) => b.t === 'heading').map((b) => (b as { level: number }).level);
  if (levels.length) {
    const top = Math.min(...levels);
    const count = levels.filter((l) => l === top).length;
    if (count >= 2) {
      const chapters: Chapter[] = [];
      let current: Chapter | null = null;
      for (const b of doc.blocks) {
        if (b.t === 'heading' && b.level === top) {
          current = { title: plain(b.c).trim() || fallbackTitle, blocks: [b] };
          chapters.push(current);
        } else {
          if (!current) {
            current = { title: fallbackTitle, blocks: [] };
            chapters.push(current);
          }
          current.blocks.push(b);
        }
      }
      return chapters;
    }
  }
  return [{ title: fallbackTitle, blocks: doc.blocks }];
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface EpubMeta {
  title: string;
  author?: string;
  lang?: string;
  id?: string;
  modified?: Date;
}

export function buildEpub(doc: Doc, meta: EpubMeta, emit: EmitOptions = {}): Uint8Array {
  const ctx = new EmitContext(doc, { ...emit, lang: emit.lang ?? meta.lang });
  const lang = ctx.lang;
  const id = meta.id ?? `urn:uuid:${uuid()}`;
  const modified = (meta.modified ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const title = escapeHtml(meta.title);
  const author = meta.author ? escapeHtml(meta.author) : '';
  const chapters = splitChapters(doc, meta.title);
  const file = (i: number) => `chap-${String(i + 1).padStart(3, '0')}.xhtml`;
  const notesFile = 'notes.xhtml';

  // I capitoli si generano subito: raccolgono le note e le citazioni.
  const bodies = chapters.map((c, i) => htmlBlocks(c.blocks, { xhtml: true, ctx, file: file(i), notesFile }));
  const back: { title: string; file: string; body: string }[] = [];
  const notesBody = htmlNotes({ xhtml: true, ctx });
  if (notesBody) back.push({ title: ctx.terms.notes, file: notesFile, body: notesBody });
  const refsBody = htmlReferences({ xhtml: true, ctx });
  if (refsBody) back.push({ title: ctx.terms.references, file: 'references.xhtml', body: refsBody });
  const all = [...chapters.map((c, i) => ({ title: c.title, file: file(i), body: bodies[i] })), ...back];

  const xhtml = (chTitle: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(chTitle)}</title>
<link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
${body}
</body>
</html>
`;

  const files: Zippable = {};
  // "mimetype" deve essere il primo file, non compresso.
  files['mimetype'] = [strToU8('application/epub+zip'), { level: 0 }];
  files['META-INF/container.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`);

  const manifestItems = all
    .map((c, i) => `    <item id="c${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const spineItems = all.map((_, i) => `    <itemref idref="c${i + 1}"/>`).join('\n');

  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeHtml(id)}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>${lang}</dc:language>
${author ? `    <dc:creator>${author}</dc:creator>\n` : ''}    <meta property="dcterms:modified">${modified}</meta>
    <meta name="generator" content="Wrambi"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>
`);

  const navList = all.map((c) => `      <li><a href="${c.file}">${escapeHtml(c.title)}</a></li>`).join('\n');
  files['OEBPS/nav.xhtml'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8" /><title>${title}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${escapeHtml(ctx.terms.toc)}</h1>
    <ol>
${navList}
    </ol>
  </nav>
</body>
</html>
`);

  const navPoints = all
    .map(
      (c, i) => `    <navPoint id="np${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeHtml(c.title)}</text></navLabel>
      <content src="${c.file}"/>
    </navPoint>`,
    )
    .join('\n');
  files['OEBPS/toc.ncx'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${escapeHtml(id)}"/></head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`);

  files['OEBPS/style.css'] = strToU8(EPUB_CSS);
  for (const c of all) files[`OEBPS/${c.file}`] = strToU8(xhtml(c.title, c.body));

  return zipSync(files, { level: 6 });
}

export function buildEpubFromMarkdown(src: string, meta: EpubMeta, emit: EmitOptions = {}): Uint8Array {
  return buildEpub(parse(src, { citeKeys: emit.bib?.keys }), meta, emit);
}

/* ───────────────────────────── Lettura ───────────────────────────── */

export interface ExtractedBook {
  title: string;
  author: string;
  /** Testo in Markdown, nell'ordine di lettura. */
  text: string;
  chapters: number;
}

function resolvePath(base: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0]);
  const parts = (base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '').split('/').filter(Boolean);
  for (const seg of clean.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function parseXhtml(text: string): Document {
  const xml = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  if (xml.getElementsByTagName('parsererror').length === 0) return xml;
  // Molti EPUB reali contengono XHTML non perfetto: si ripiega sul parser HTML.
  return new DOMParser().parseFromString(text, 'text/html');
}

function byLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name);
}

export function readEpub(bytes: Uint8Array): ExtractedBook {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('Il file non è un EPUB valido (archivio illeggibile).');
  }
  const get = (path: string) => {
    const hit = entries[path] ?? entries[Object.keys(entries).find((k) => k.toLowerCase() === path.toLowerCase()) ?? ''];
    return hit ? strFromU8(hit) : null;
  };
  const container = get('META-INF/container.xml');
  if (!container) throw new Error('EPUB non valido: manca META-INF/container.xml.');
  const rootfile = byLocalName(parseXml(container), 'rootfile')[0]?.getAttribute('full-path');
  if (!rootfile) throw new Error('EPUB non valido: nessun file OPF indicato.');
  const opfText = get(rootfile);
  if (!opfText) throw new Error(`EPUB non valido: manca ${rootfile}.`);
  const opf = parseXml(opfText);

  const title = byLocalName(opf, 'title')[0]?.textContent?.trim() ?? '';
  const author = byLocalName(opf, 'creator')[0]?.textContent?.trim() ?? '';
  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const item of byLocalName(opf, 'item')) {
    manifest.set(item.getAttribute('id') ?? '', {
      href: item.getAttribute('href') ?? '',
      type: item.getAttribute('media-type') ?? '',
      props: item.getAttribute('properties') ?? '',
    });
  }

  const parts: string[] = [];
  let chapters = 0;
  for (const ref of byLocalName(opf, 'itemref')) {
    if (ref.getAttribute('linear') === 'no') continue;
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    if (!item || !/html/.test(item.type) || item.props.includes('nav')) continue;
    const content = get(resolvePath(rootfile, item.href));
    if (!content) continue;
    const dom = parseXhtml(content);
    const body = byLocalName(dom, 'body')[0] ?? dom.documentElement;
    const md = htmlToMarkdown(body).trim();
    if (md) {
      parts.push(md);
      chapters++;
    }
  }
  if (!parts.length) throw new Error('Nessun testo leggibile trovato nell\'EPUB (forse è protetto da DRM).');
  return { title, author, text: parts.join('\n\n* * *\n\n') + '\n', chapters };
}

/* ─────────────────────── HTML → Markdown (per la lettura) ─────────────────────── */

const SKIP = new Set(['script', 'style', 'head', 'nav', 'noscript', 'template', 'svg', 'math', 'iframe', 'button', 'form']);

function collapse(s: string): string {
  return s.replace(/[ \t\r\n\f ]+/g, (m) => (m.includes(' ') && m.length === 1 ? ' ' : ' '));
}

function inlineMd(node: Node): string {
  let s = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      s += collapse(child.textContent ?? '');
      return;
    }
    if (child.nodeType !== 1) return;
    const el = child as Element;
    const tag = el.localName;
    if (SKIP.has(tag)) return;
    const inner = () => inlineMd(el);
    const wrap = (mark: string, close = mark) => {
      const t = inner();
      const trimmed = t.trim();
      if (!trimmed) return t;
      const lead = t.match(/^\s*/)![0];
      const trail = t.match(/\s*$/)![0];
      return `${lead}${mark}${trimmed}${close}${trail}`;
    };
    switch (tag) {
      case 'strong':
      case 'b':
        s += wrap('**');
        break;
      case 'em':
      case 'i':
      case 'cite':
        s += wrap('*');
        break;
      case 'u':
        s += wrap('<u>', '</u>');
        break;
      case 's':
      case 'del':
      case 'strike':
        s += wrap('~~');
        break;
      case 'code':
        s += '`' + (el.textContent ?? '').replace(/`/g, "'") + '`';
        break;
      case 'br':
        s += '\n';
        break;
      case 'img':
        s += el.getAttribute('alt') ? `[${el.getAttribute('alt')}]` : '';
        break;
      case 'a': {
        const href = el.getAttribute('href') ?? '';
        const t = inner();
        s += /^https?:/i.test(href) && t.trim() ? `[${t.trim()}](${href})` : t;
        break;
      }
      case 'sup':
      case 'sub':
        s += inner();
        break;
      default:
        s += isBlock(tag) ? '\n' + blocksMd(el).trim() + '\n' : inner();
    }
  });
  return s;
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'table',
  'dl', 'dt', 'dd', 'body', 'html', 'center', 'address',
]);

function isBlock(tag: string): boolean {
  return BLOCK_TAGS.has(tag);
}

function blocksMd(root: Element): string {
  const out: string[] = [];
  let inlineBuf = '';
  const flush = () => {
    const t = inlineBuf.replace(/[ \t]*\n[ \t]*/g, '\n').trim();
    if (t) out.push(t);
    inlineBuf = '';
  };
  root.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      inlineBuf += collapse(child.textContent ?? '');
      return;
    }
    if (child.nodeType !== 1) return;
    const el = child as Element;
    const tag = el.localName;
    if (SKIP.has(tag)) return;
    if (!isBlock(tag)) {
      const tmp = el.ownerDocument.createElement('span');
      tmp.appendChild(el.cloneNode(true));
      inlineBuf += inlineMd(tmp);
      return;
    }
    flush();
    switch (tag) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const t = inlineMd(el).replace(/\s+/g, ' ').trim();
        if (t) out.push(`${'#'.repeat(Number(tag[1]))} ${t}`);
        break;
      }
      case 'p':
      case 'dt':
      case 'dd':
      case 'figcaption':
      case 'address': {
        const t = inlineMd(el).replace(/[ \t]*\n[ \t]*/g, '\n').trim();
        if (t) out.push(t);
        break;
      }
      case 'ul':
      case 'ol': {
        let n = Number(el.getAttribute('start') ?? 1) || 1;
        const items: string[] = [];
        el.childNodes.forEach((li) => {
          if (li.nodeType !== 1 || (li as Element).localName !== 'li') return;
          const body = blocksMd(li as Element).trim();
          if (!body) return;
          const marker = tag === 'ol' ? `${n++}. ` : '- ';
          items.push(marker + body.replace(/\n/g, '\n' + ' '.repeat(marker.length)));
        });
        if (items.length) out.push(items.join('\n'));
        break;
      }
      case 'blockquote': {
        const t = blocksMd(el).trim();
        if (t) out.push(t.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n'));
        break;
      }
      case 'pre':
        out.push('```\n' + (el.textContent ?? '').replace(/\n$/, '') + '\n```');
        break;
      case 'hr':
        out.push('* * *');
        break;
      case 'table': {
        const rows = Array.from(el.querySelectorAll('tr')).map((tr) =>
          Array.from(tr.children)
            .map((td) => inlineMd(td).replace(/\s+/g, ' ').trim())
            .join(' | '),
        );
        if (rows.length) out.push(rows.join('\n'));
        break;
      }
      default: {
        const t = blocksMd(el).trim();
        if (t) out.push(t);
      }
    }
  });
  flush();
  return out.join('\n\n');
}

export function htmlToMarkdown(root: Element): string {
  return blocksMd(root).replace(/\n{3,}/g, '\n\n');
}

/** Testo di una pagina HTML (file .html della biblioteca). */
export function readHtml(source: string): { title: string; text: string } {
  const dom = new DOMParser().parseFromString(source, 'text/html');
  const title = dom.querySelector('title')?.textContent?.trim() ?? '';
  const body = dom.body ?? dom.documentElement;
  return { title, text: htmlToMarkdown(body) + '\n' };
}

/* ───────────────────────────── Copertina (anteprime) ───────────────────────────── */

export interface EpubCover {
  title: string;
  author: string;
  image: { data: Uint8Array; type: string } | null;
}

/**
 * Titolo, autore e immagine di copertina di un EPUB, decomprimendo solo i
 * file che servono (l'indice del libro e l'immagine).
 */
export function epubCover(bytes: Uint8Array): EpubCover {
  const small = unzipSync(bytes, { filter: (f) => /container\.xml$|\.opf$/i.test(f.name) });
  const find = (path: string) => small[path] ?? small[Object.keys(small).find((k) => k.toLowerCase() === path.toLowerCase()) ?? ''];
  const container = find('META-INF/container.xml');
  const rootfile = container ? byLocalName(parseXml(strFromU8(container)), 'rootfile')[0]?.getAttribute('full-path') : null;
  const opfBytes = rootfile ? find(rootfile) : null;
  if (!rootfile || !opfBytes) return { title: '', author: '', image: null };
  const opf = parseXml(strFromU8(opfBytes));
  const title = byLocalName(opf, 'title')[0]?.textContent?.trim() ?? '';
  const author = byLocalName(opf, 'creator')[0]?.textContent?.trim() ?? '';

  const items = byLocalName(opf, 'item').map((it) => ({
    id: it.getAttribute('id') ?? '',
    href: it.getAttribute('href') ?? '',
    type: it.getAttribute('media-type') ?? '',
    props: it.getAttribute('properties') ?? '',
  }));
  const metaCover = byLocalName(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
  const isImage = (t: string) => /^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(t);
  const cover =
    items.find((i) => i.props.split(/\s+/).includes('cover-image') && isImage(i.type)) ??
    items.find((i) => i.id === metaCover && isImage(i.type)) ??
    items.find((i) => isImage(i.type) && /cover|copertina/i.test(i.id + ' ' + i.href));
  if (!cover) return { title, author, image: null };
  const path = resolvePath(rootfile, cover.href);
  const img = unzipSync(bytes, { filter: (f) => f.name === path || f.name.toLowerCase() === path.toLowerCase() });
  const data = Object.values(img)[0];
  return { title, author, image: data ? { data, type: cover.type } : null };
}
