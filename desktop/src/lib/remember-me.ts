/**
 * "Remember me" credential storage.
 *
 * Preferred backend: Electron `safeStorage` (OS-keychain-backed encryption
 * on macOS, DPAPI on Windows, libsecret on Linux). Reaching it requires the
 * preload bridge added in the main process — see [electron/preload.ts]. The
 * OS keychain unlocks with the user's logged-in session, which on most
 * modern devices means the login/PIN/biometric that gates the OS itself.
 * That satisfies the "verify with device owner" requirement in the product
 * spec without needing a separate biometric prompt.
 *
 * Fallback backend: if the bridge is not present (running in a plain browser
 * preview, or in an old build without the preload update), we transparently
 * fall back to `localStorage` with a loud console warning. Falling back is
 * better than throwing — the login form still works; ops just get a warning
 * that plaintext credentials are on disk. Never ship a production build
 * without the bridge in place.
 *
 * We store BOTH email + password because the product spec is a "keep me
 * signed in" pattern (single tap to bill). The remaining brute-force risk is
 * mitigated by:
 *   - Backend rate limits (5/min per IP on /auth/login)
 *   - Email OTP gate (server-side flag, off by default) or TOTP
 *   - In-app math CAPTCHA after 3 wrong tries
 */

// ---- Bridge shape ---------------------------------------------------------
//
// The real type comes from `electron/preload.ts`, hoisted onto Window in
// `src/env.d.ts`. We use `window.retailos?.credentials` directly (all
// members exist per the preload contract) and treat the whole thing as
// optional at runtime so a browser-preview build still compiles + runs.

type CredentialBridge = NonNullable<
  NonNullable<Window['retailos']>['credentials']
>;

// Storage key for the fallback path. Deliberately distinctive so ops greps
// can find machines that were operating without safeStorage.
const FALLBACK_KEY = 'retailos:remembered-credentials:PLAINTEXT_FALLBACK';

function getBridge(): CredentialBridge | null {
  return window.retailos?.credentials ?? null;
}

let fallbackWarnedOnce = false;
function warnFallback(): void {
  if (fallbackWarnedOnce) return;
  fallbackWarnedOnce = true;
  // eslint-disable-next-line no-console
  console.warn(
    '[RetailOS] Electron safeStorage bridge not available — remember-me is '
      + 'falling back to plaintext localStorage. This is acceptable in a '
      + 'browser preview but must never happen in a shipped desktop build.',
  );
}

export async function saveRememberedCredentials(
  email: string,
  password: string,
): Promise<void> {
  const bridge = getBridge();
  if (bridge) {
    await bridge.save(email, password);
    return;
  }
  warnFallback();
  window.localStorage.setItem(FALLBACK_KEY, JSON.stringify({ email, password }));
}

export async function loadRememberedCredentials(): Promise<
  { email: string; password: string } | null
> {
  const bridge = getBridge();
  if (bridge) return bridge.load();
  warnFallback();
  const raw = window.localStorage.getItem(FALLBACK_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { email: string; password: string };
    if (typeof parsed.email !== 'string' || typeof parsed.password !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    // Corrupt entry — clean it up so we don't warn about the same bad row.
    window.localStorage.removeItem(FALLBACK_KEY);
    return null;
  }
}

export async function clearRememberedCredentials(): Promise<void> {
  const bridge = getBridge();
  if (bridge) {
    await bridge.clear();
    return;
  }
  window.localStorage.removeItem(FALLBACK_KEY);
}

/**
 * True when the app is talking to a real OS keychain via the Electron bridge.
 * The login form uses this to badge the "Remember me" checkbox appropriately
 * — a green shield when secure, a subdued hint when the fallback is active.
 */
export async function isRememberMeSecure(): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge) return false;
  try {
    return await bridge.isSecure();
  } catch {
    return false;
  }
}
