/**
 * Un file .txt non è Markdown: per convertirlo, ogni carattere va preso alla
 * lettera. Qui il testo semplice diventa Markdown "neutro": paragrafi separati
 * da righe vuote, a capo conservati, nessun simbolo interpretato.
 */
const PUNCT = /[\\`*_{}[\]<>()#+\-.!|~]/g;

export function parsePlain(text: string): string {
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/);
  return paragraphs
    .map((p) =>
      p
        .split('\n')
        .map((line) => line.trim().replace(PUNCT, '\\$&'))
        .filter((line) => line !== '')
        .join('\\\n'),
    )
    .filter((p) => p !== '')
    .join('\n\n');
}
