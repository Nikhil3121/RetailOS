/**
 * Where a queued sale is allowed to be sent.
 *
 * ── THE BUG THIS EXISTS TO PREVENT ─────────────────────────────────────────
 * The renderer and the main process each had their own idea of the API URL.
 * The renderer read VITE_API_BASE_URL (pointing at the hosted backend); the
 * main process read RETAILOS_API_BASE_URL, defaulting to localhost. Nothing
 * compared them.
 *
 * So a cashier could log in against the hosted server, receive a token signed
 * with ITS secret, and the sync worker would post that token to a completely
 * different backend — which rejected every sale with INVALID_TOKEN and retried
 * forever. The bills were safe in SQLite, but they were never going to sync,
 * and the only symptom was a 401 in a log nobody was watching.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 * A token may only be sent to the server that issued it. The renderer is the
 * one that knows where it authenticated, so it supplies that origin alongside
 * the credential — the two travel together because they only mean anything
 * together.
 *
 * An explicit RETAILOS_API_BASE_URL still wins as an operator override, but it
 * must AGREE with where the renderer logged in. A disagreement is reported
 * loudly rather than resolved by picking one, because either choice would be a
 * guess about where a shop's money should go.
 */

export type SyncTarget =
  | { ok: true; url: string; source: 'renderer' | 'configured' }
  | { ok: false; error: string };

/** Trailing slashes and case differences are not real differences. */
function normalise(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Compare by origin: a path or trailing slash does not change the server. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin.toLowerCase() === new URL(b).origin.toLowerCase();
  } catch {
    return false;
  }
}

function isUsableUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    // Only real HTTP(S) endpoints. Anything else (file:, data:) would be a
    // sign something is very wrong, and is not somewhere a token should go.
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Decide where this run may post.
 *
 * @param rendererUrl  Where the renderer authenticated. Authoritative when
 *                     nothing is explicitly configured, because that is where
 *                     the token actually came from.
 * @param configuredUrl RETAILOS_API_BASE_URL, when an operator set one.
 */
export function resolveSyncTarget(
  rendererUrl: string | null | undefined,
  configuredUrl: string | null | undefined,
): SyncTarget {
  const renderer = rendererUrl ? normalise(rendererUrl) : null;
  const configured = configuredUrl ? normalise(configuredUrl) : null;

  if (renderer && !isUsableUrl(renderer)) {
    return { ok: false, error: 'The application supplied an invalid API address.' };
  }

  // Nothing from the renderer: an older caller, or a test. Fall back to the
  // configured value exactly as before, so this cannot break existing flows.
  if (!renderer) {
    if (!configured || !isUsableUrl(configured)) {
      return { ok: false, error: 'No API address is configured for synchronisation.' };
    }
    return { ok: true, url: configured, source: 'configured' };
  }

  if (!configured) {
    return { ok: true, url: renderer, source: 'renderer' };
  }

  if (!sameOrigin(renderer, configured)) {
    // Refusing is the point. Sending the token to `configured` would repeat
    // the original bug; sending it to `renderer` would silently ignore an
    // operator's explicit setting. Neither is ours to decide.
    return {
      ok: false,
      error:
        `Signed in to ${originOf(renderer)} but synchronisation is configured for ` +
        `${originOf(configured)}. Sales will not be sent until these match.`,
    };
  }

  return { ok: true, url: configured, source: 'configured' };
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
