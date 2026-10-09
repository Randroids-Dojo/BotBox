// Button hints that follow the active device: keyboard keys, pad buttons, or nothing on touch
// (the CSS hides hint rows when the last input was a touch).

import { el } from './core';

/** A keyboard label and its gamepad equivalent; CSS shows the one for the current device. */
export function key(keyboard: string, pad: string): HTMLElement[] {
  return [el('b.k-kb', keyboard), el('b.k-pad', pad)];
}
