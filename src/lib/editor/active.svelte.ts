import type { ActiveFormat } from './format';
import { editor } from './controller';
import { ui } from '../state.svelte';

/** Formattazione al cursore, per lo stato dei pulsanti della barra. */
export const active = $state<ActiveFormat & { empty: boolean }>({
  block: 'p',
  strong: false,
  em: false,
  s: false,
  code: false,
  u: false,
  link: false,
  empty: true,
});

let frame = 0;
editor.onSelection((info) => {
  // Aggiorna al massimo una volta per fotogramma.
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    Object.assign(active, info);
    ui.selectionEmpty = info.empty;
  });
});
