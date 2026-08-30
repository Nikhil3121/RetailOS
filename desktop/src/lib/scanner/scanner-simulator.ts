/**
 * A barcode scanner made of keyboard events.
 *
 * ── WHY IT DISPATCHES REAL EVENTS ──────────────────────────────────────────
 * The tempting shortcut is to call the catalog lookup directly with a barcode
 * string. That proves the catalog works and proves nothing about the thing
 * that actually breaks: the input boundary. Focus, controlled-input state,
 * key handlers, the Enter suffix and the speed at which React can flush state
 * are exactly where wedge scanners go wrong.
 *
 * So this types. It dispatches genuine KeyboardEvents at scanner speed into a
 * real focused element, and also updates the element's value the way a browser
 * would — because a KeyboardEvent alone does not change an input's value, and
 * a simulator that skipped that would test a boundary no real scanner uses.
 *
 * Development and test only. Nothing imports it into a production path.
 */

/** Characters per second for a typical USB wedge scanner. */
export const SCANNER_CHARS_PER_SECOND = 200;

export interface SimulateOptions {
  /** Delay between characters. Defaults to scanner speed (~5ms). */
  intervalMs?: number;
  /** Append the Enter most scanners send as a suffix. */
  enterSuffix?: boolean;
  /** Where to type. Defaults to document.activeElement. */
  target?: HTMLElement | null;
}

function dispatchKey(target: EventTarget, key: string): void {
  const init: KeyboardEventInit = {
    key,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keypress', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
}

/**
 * Update a controlled React input the way a real keystroke does.
 *
 * React installs its own value setter on the element, so assigning `.value`
 * directly is swallowed and the component never re-renders. Going through the
 * prototype setter and then firing `input` is what makes React observe the
 * change — the same trick browsers' own autofill relies on.
 */
function setNativeValue(element: HTMLElement, value: string): void {
  const proto = Object.getPrototypeOf(element) as object;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor?.set) descriptor.set.call(element, value);
  else (element as HTMLInputElement).value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Type a barcode at scanner speed into the focused element.
 *
 * Returns the element it typed into, or null when there was nowhere to type —
 * a real scan into an unfocused window goes nowhere too, and pretending
 * otherwise would hide a genuine failure mode.
 */
export async function simulateScan(
  barcode: string,
  options: SimulateOptions = {},
): Promise<HTMLElement | null> {
  // `??` would treat an EXPLICIT `target: null` as "not supplied" and fall
  // back to activeElement — the opposite of what the caller asked for. An
  // explicit null means "there is nowhere to type", which is exactly the
  // unfocused-window case worth being able to express.
  const target = ('target' in options
    ? options.target
    : typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null)
      : null) as HTMLElement | null;
  if (!target) return null;

  const interval = options.intervalMs ?? Math.round(1000 / SCANNER_CHARS_PER_SECOND);
  const isInput =
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

  // A scanner replaces whatever is there; it does not append to a half-typed
  // search term.
  if (isInput) setNativeValue(target, '');

  let typed = '';
  for (const char of barcode) {
    typed += char;
    dispatchKey(target, char);
    if (isInput) setNativeValue(target, typed);
    if (interval > 0) await wait(interval);
  }

  if (options.enterSuffix !== false) dispatchKey(target, 'Enter');
  return target;
}

/**
 * Type at human speed.
 *
 * The control case: this must NOT be classified as a scan, and the tests use
 * it to prove that a cashier typing a code by hand is treated as a person.
 */
export async function simulateTyping(
  text: string,
  options: SimulateOptions = {},
): Promise<HTMLElement | null> {
  return simulateScan(text, { ...options, intervalMs: options.intervalMs ?? 120 });
}

/**
 * Two scans back to back with no gap.
 *
 * Reproduces an impatient cashier double-triggering the scanner, which is
 * where naive buffering concatenates two codes into one nonexistent barcode.
 */
export async function simulateRapidScans(
  barcodes: string[],
  options: SimulateOptions = {},
): Promise<void> {
  for (const barcode of barcodes) {
    await simulateScan(barcode, options);
  }
}

/** Timed keystrokes for the detector, with no DOM involved. */
export function scanKeystrokes(
  barcode: string,
  startAt = 0,
  intervalMs = 5,
): { key: string; timeStamp: number }[] {
  const strokes = barcode
    .split('')
    .map((key, i) => ({ key, timeStamp: startAt + i * intervalMs }));
  return [
    ...strokes,
    { key: 'Enter', timeStamp: startAt + barcode.length * intervalMs },
  ];
}

/** The same, at human typing speed. */
export function typedKeystrokes(
  text: string,
  startAt = 0,
  intervalMs = 140,
): { key: string; timeStamp: number }[] {
  return scanKeystrokes(text, startAt, intervalMs);
}
