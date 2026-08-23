/**
 * A tiny in-app arithmetic CAPTCHA.
 *
 * Purpose: after N failed login attempts, force the caller to prove a human
 * is at the keyboard. Not intended as a replacement for a real bot-detection
 * service (hCaptcha, Turnstile) — those need a public site key and phone-home
 * traffic that we don't want in a self-hosted POS. What this DOES buy us:
 *   - stops trivial credential-stuffing scripts that hammer /auth/login
 *   - forces a per-attempt cognitive delay that human users don't feel but
 *     scripts do
 *   - regenerates on every wrong answer, so guessing the answer is worthless
 *
 * The CAPTCHA is generated client-side and validated client-side; the backend
 * already has slowapi rate limits that stop the same IP after 5 wrong login
 * attempts a minute. Layer defence, not sole defence.
 */

export interface MathCaptcha {
  a: number;
  b: number;
  op: '+' | '-';
  expected: number;
  /** Human-readable prompt, e.g. "7 + 4". */
  prompt: string;
}

/**
 * Fresh random CAPTCHA. Numbers land in 2–9 (so '2 + 3' is trivial, but
 * '0 - 9' or '1 - 8' never happens and we don't have to teach shopkeepers
 * about negative numbers). Both operators produce a non-negative result.
 */
export function generateMathCaptcha(): MathCaptcha {
  // Math.random is fine — this is a UX challenge, not a crypto secret.
  const a = 2 + Math.floor(Math.random() * 8); // 2..9
  const b = 2 + Math.floor(Math.random() * 8); // 2..9
  const op: '+' | '-' = Math.random() < 0.5 ? '+' : '-';

  // For subtraction, order the operands so the answer is always >= 0.
  const [big, small] = a >= b ? [a, b] : [b, a];
  const expected = op === '+' ? a + b : big - small;
  const displayA = op === '+' ? a : big;
  const displayB = op === '+' ? b : small;

  return {
    a: displayA,
    b: displayB,
    op,
    expected,
    prompt: `${displayA} ${op} ${displayB}`,
  };
}

/**
 * Verify the user's typed answer. Trims + parses so "  9 " matches 9.
 * Returns false for empty / non-numeric input (never throws).
 */
export function verifyMathCaptcha(captcha: MathCaptcha, input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return false;
  return n === captcha.expected;
}
