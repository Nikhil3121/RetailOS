/**
 * Which URLs the app may navigate to, and which the OS may be asked to open.
 *
 * Split out of `main.ts` so it can be tested without booting Electron — the
 * main module calls `app.whenReady()` at import time, so anything living there
 * is untestable by construction, and a security check nobody can test is a
 * security check nobody can trust.
 */

/** The only schemes the operating system may be asked to open on our behalf. */
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

export function schemeOf(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return '<unparseable>';
  }
}

/**
 * May this URL be handed to `shell.openExternal`?
 *
 * `openExternal` delegates to the operating system's protocol handlers, so an
 * unchecked URL here does not mean "opens a web page" — it means "runs whatever
 * Windows has registered for that scheme". A `file:///…/payload.exe` launches
 * the binary; schemes such as `ms-msdt:` and `search-ms:` have been used in
 * real attacks to get code execution from nothing more than a crafted link.
 *
 * The renderer displays supplier names, customer notes and product data that
 * ultimately come from a database, so a hostile or merely careless string
 * reaching a link is a realistic path rather than a theoretical one.
 *
 * ALLOW-LIST, never deny-list: a scheme that turns out to be dangerous next
 * year must not be exploitable here by default.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return EXTERNAL_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Navigation that stays inside the app and needs no interception.
 *
 * In development that is the Vite dev server; in a packaged build it is the
 * bundled `file://` renderer.
 *
 * Compared by parsed ORIGIN rather than `startsWith`, which is what the
 * previous check used. "http://localhost:5273.evil.com" passes a prefix test
 * and is an entirely different origin — the exact shape of bug that turns a
 * navigation guard into decoration.
 */
export function isInternalUrl(url: string, devServer: string): boolean {
  try {
    const target = new URL(url);
    if (target.protocol === 'file:') return true;
    return target.origin === new URL(devServer).origin;
  } catch {
    return false;
  }
}
