// Money, ranks and a count-up helper for the career screens.

/** $1,250 */
export function money(n: number): string {
  const v = Math.round(n);
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US')}`;
}

/** #43, or Unranked. */
export function rankText(r: number | null): string {
  return r === null ? 'Unranked' : `#${r}`;
}

/** Count a number from `from` to `to` over `ms`, writing it through `fmt`. Resolves at the end.
 *  `skip()` jumps to the end. */
export function countUp(node: HTMLElement, from: number, to: number, ms: number, fmt: (n: number) => string = money): { done: Promise<void>; skip(): void } {
  let raf = 0;
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    const t0 = performance.now();
    finish = () => {
      cancelAnimationFrame(raf);
      node.textContent = fmt(to);
      resolve();
    };
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      node.textContent = fmt(from + (to - from) * e);
      if (k < 1) raf = requestAnimationFrame(step);
      else finish();
    };
    node.textContent = fmt(from);
    if (ms <= 0) finish();
    else raf = requestAnimationFrame(step);
  });
  return { done, skip: () => finish() };
}
