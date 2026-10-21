/**
 * Sistema operativo su cui gira Wrambi: Windows, macOS o Linux.
 * Cambia caratteri proposti, nomi dei tasti e qualche dicitura.
 */
export type Platform = 'windows' | 'macos' | 'linux';

function detect(): Platform {
  if (typeof navigator === 'undefined') return 'windows';
  const ua = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  if (/Mac/i.test(ua)) return 'macos';
  if (/Win/i.test(ua)) return 'windows';
  if (/Linux|X11|CrOS/i.test(ua)) return 'linux';
  return 'windows';
}

export const PLATFORM: Platform = detect();
export const IS_MAC = PLATFORM === 'macos';
export const IS_WINDOWS = PLATFORM === 'windows';

/** Nome del sistema, da mostrare: «Come Windows», «Come macOS». */
export const OS_NAME = { windows: 'Windows', macos: 'macOS', linux: 'Linux' }[PLATFORM];

/** Lingua dell'interfaccia al primo avvio: quella del sistema, se è una delle tre. */
export function systemLanguage(): 'it' | 'en' | 'fr' {
  const l = (typeof navigator !== 'undefined' ? navigator.language : 'it').toLowerCase();
  if (l.startsWith('fr')) return 'fr';
  if (l.startsWith('it')) return 'it';
  return 'en';
}
