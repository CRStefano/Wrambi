/**
 * Segna una frase da tradurre più tardi, quando si mostra: `tk('Letto')` resta
 * la frase italiana, e `t(...)` la traduce al momento. Serve alle costanti
 * definite prima di sapere la lingua; il test delle traduzioni le trova così.
 */
export function tk<T extends string>(key: T): T {
  return key;
}
