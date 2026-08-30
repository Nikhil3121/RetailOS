/**
 * Tell a barcode scanner apart from a person typing.
 *
 * ── WHAT THIS IS FOR, AND WHAT IT IS NOT ───────────────────────────────────
 * A USB keyboard-wedge scanner is indistinguishable from a keyboard except in
 * ONE respect: speed. It emits a whole code in tens of milliseconds and ends
 * with Enter. A human cannot type twelve digits in 120ms.
 *
 * This classifies keystroke TIMING. It deliberately does NOT decide how a cart
 * treats the result: Billing already classifies a scan by whether the string
 * matched a variant's BARCODE field, which is the rule specified for this
 * business, and that rule is untouched. Using timing to override it would
 * quietly change when the duplicate-scan guard fires.
 *
 * So this powers the diagnostics screen and the simulator, and is available to
 * any future feature that needs "was that a device or a person?" — without
 * silently rewriting billing behaviour.
 *
 * ── WHY TIMING AND NOT A PREFIX ────────────────────────────────────────────
 * Many scanners can be configured to send a prefix character, but shops buy
 * whatever is cheap and it arrives factory-default. Timing works with an
 * unconfigured scanner out of the box.
 */

/** Slowest gap between characters still considered machine-fast, in ms. */
export const MAX_KEYSTROKE_GAP_MS = 50;

/** Shortest code worth treating as a scan. Below this, a fast typist and a
 *  scanner are genuinely ambiguous, and guessing wrong is worse than not
 *  guessing. */
export const MIN_SCAN_LENGTH = 4;

export interface Keystroke {
  key: string;
  timeStamp: number;
}

export interface ScanCandidate {
  value: string;
  /** ms from first character to the terminating Enter. */
  durationMs: number;
  /** Largest gap seen between consecutive characters. */
  maxGapMs: number;
}

export type Classification =
  | { source: 'scanner'; candidate: ScanCandidate }
  | { source: 'human'; candidate: ScanCandidate; reason: HumanReason };

export type HumanReason = 'too-slow' | 'too-short' | 'empty';

/**
 * Classify a completed keystroke sequence (the characters, then Enter).
 *
 * The rule is deliberately strict: EVERY gap must be machine-fast. A single
 * human-length pause means a person was involved — someone typing a code by
 * hand, or a scan interrupted midway. Averaging would let a long pause hide
 * behind a run of fast keys.
 */
export function classify(strokes: Keystroke[]): Classification {
  const chars = strokes.filter((s) => s.key.length === 1);
  const value = chars.map((s) => s.key).join('');

  if (chars.length === 0) {
    return {
      source: 'human',
      reason: 'empty',
      candidate: { value: '', durationMs: 0, maxGapMs: 0 },
    };
  }

  let maxGapMs = 0;
  for (let i = 1; i < chars.length; i++) {
    maxGapMs = Math.max(maxGapMs, chars[i].timeStamp - chars[i - 1].timeStamp);
  }
  const durationMs = chars[chars.length - 1].timeStamp - chars[0].timeStamp;
  const candidate: ScanCandidate = { value, durationMs, maxGapMs };

  if (value.length < MIN_SCAN_LENGTH) {
    return { source: 'human', reason: 'too-short', candidate };
  }
  if (maxGapMs > MAX_KEYSTROKE_GAP_MS) {
    return { source: 'human', reason: 'too-slow', candidate };
  }
  return { source: 'scanner', candidate };
}

export interface DetectorOptions {
  onScan: (candidate: ScanCandidate) => void;
  /** Fires for input that ended in Enter but was judged human. */
  onHuman?: (candidate: ScanCandidate, reason: HumanReason) => void;
  maxGapMs?: number;
  minLength?: number;
}

/**
 * Accumulates keystrokes and reports completed sequences.
 *
 * Stateful but tiny, and driven entirely by `push` — so tests feed it
 * synthetic timings without any DOM, and the DOM listener is a thin wrapper.
 */
export class WedgeDetector {
  private strokes: Keystroke[] = [];

  constructor(private readonly options: DetectorOptions) {}

  /** Feed one keystroke. Enter terminates and classifies the sequence. */
  push(stroke: Keystroke): Classification | null {
    if (stroke.key === 'Enter') {
      const strokes = this.strokes;
      this.strokes = [];
      if (strokes.length === 0) return null;

      const result = classifyWith(strokes, this.options);
      if (result.source === 'scanner') this.options.onScan(result.candidate);
      else this.options.onHuman?.(result.candidate, result.reason);
      return result;
    }

    // Anything that is not a single character (Shift, Tab, arrows) is not part
    // of a barcode. A scanner emits only printable characters plus Enter.
    if (stroke.key.length !== 1) {
      // Navigation mid-sequence means a person is editing: abandon it rather
      // than stitching two halves into one bogus code.
      if (stroke.key === 'Escape' || stroke.key.startsWith('Arrow')) this.strokes = [];
      return null;
    }

    // A long pause starts a new sequence: whatever came before was a separate
    // interaction, and joining them would invent a barcode nobody scanned.
    const previous = this.strokes[this.strokes.length - 1];
    const gap = this.options.maxGapMs ?? MAX_KEYSTROKE_GAP_MS;
    if (previous && stroke.timeStamp - previous.timeStamp > gap * 4) {
      this.strokes = [];
    }

    this.strokes.push(stroke);
    return null;
  }

  /** Discard anything half-typed. */
  reset(): void {
    this.strokes = [];
  }

  /** Characters buffered so far — for the diagnostics live view. */
  pending(): string {
    return this.strokes.map((s) => s.key).join('');
  }
}

function classifyWith(strokes: Keystroke[], options: DetectorOptions): Classification {
  const maxGap = options.maxGapMs ?? MAX_KEYSTROKE_GAP_MS;
  const minLength = options.minLength ?? MIN_SCAN_LENGTH;

  const base = classify(strokes);
  if (base.source === 'scanner') {
    if (base.candidate.value.length < minLength) {
      return { source: 'human', reason: 'too-short', candidate: base.candidate };
    }
    if (base.candidate.maxGapMs > maxGap) {
      return { source: 'human', reason: 'too-slow', candidate: base.candidate };
    }
  }
  return base;
}

/**
 * Is this string plausibly a barcode at all?
 *
 * Used to reject obvious rubbish before a catalog lookup — a scan that picked
 * up interference, or a code with control characters in it.
 */
export function looksLikeBarcode(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < MIN_SCAN_LENGTH || trimmed.length > 64) return false;
  // Printable, no whitespace inside. Real barcodes are alphanumeric with a
  // few separators; a space means two things ran together.
  return /^[A-Za-z0-9._:/-]+$/.test(trimmed);
}
