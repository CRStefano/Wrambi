import type { OutFormat } from './convert';

/** Formato preselezionato quando si apre la finestra di esportazione. */
export const exportState = $state<{ format: OutFormat | null }>({ format: null });
