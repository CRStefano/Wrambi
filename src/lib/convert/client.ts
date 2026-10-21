/**
 * Client del worker di conversione. Per ogni tipo di richiesta tiene al
 * massimo un lavoro in corso e uno in attesa: se si scrive più in fretta di
 * quanto si converte, le versioni intermedie vengono saltate.
 */
import type { ConvertRequest, Request, Response } from './worker';
import type { Analysis, Converted, TextualFormat } from './index';
import type { BibEntry } from '../biblio/model';

export type { ConvertRequest };

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, Pending>();
let nextId = 1;

worker.onmessage = (e: MessageEvent<Response>) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  if (e.data.ok) p.resolve(e.data.value);
  else p.reject(new Error(e.data.error));
};

type RequestBody = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never;

function send<T>(body: RequestBody): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker.postMessage({ ...body, id } as Request);
  });
}

/** Esegue solo l'ultima richiesta arrivata mentre un'altra è in corso. */
function latestOnly<A extends unknown[], T>(fn: (...args: A) => Promise<T>) {
  let running = false;
  let queued: { args: A; resolve: (v: T | null) => void } | null = null;
  const run = async (args: A, resolve: (v: T | null) => void, reject: (e: Error) => void) => {
    running = true;
    try {
      resolve(await fn(...args));
    } catch (e) {
      reject(e as Error);
    } finally {
      running = false;
      if (queued) {
        const q = queued;
        queued = null;
        run(q.args, q.resolve, () => q.resolve(null));
      }
    }
  };
  return (...args: A): Promise<T | null> =>
    new Promise((resolve, reject) => {
      if (running) {
        // La richiesta precedente in coda è superata: risponde null.
        queued?.resolve(null);
        queued = { args, resolve };
      } else run(args, resolve, reject);
    });
}

export const converter = {
  /** Carica (o toglie) la bibliografia usata per le citazioni. Restituisce il numero di voci. */
  setBibliography: (entries: BibEntry[] | null) => send<number>({ kind: 'bibliography', entries }),
  analyze: latestOnly((text: string, fallback: string, plain: boolean) => send<Analysis>({ kind: 'analyze', text, fallback, plain })),
  preview: latestOnly((text: string, format: TextualFormat | 'html-fragment', o: ConvertRequest) =>
    send<Converted>({ kind: 'convert', text, format, ...o }),
  ),
  convert: (text: string, format: TextualFormat, o: ConvertRequest) => send<Converted>({ kind: 'convert', text, format, ...o }),
  epub: (text: string, title: string, o: ConvertRequest & { author?: string }) => send<Uint8Array>({ kind: 'epub', text, ...o, title }),
};
