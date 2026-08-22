/**
 * Sentry — crash + error reporting.
 *
 * Only enabled when:
 *   1. NOT __DEV__ (dev crashes go to Metro / RN's redbox already, and
 *      shipping every hot-reload error to Sentry burns free-tier quota
 *      and drowns the signal)
 *   2. EXPO_PUBLIC_SENTRY_DSN is set in the build's env
 *
 * When either condition is false, we export a no-op init so calling
 * `Sentry.captureException(e)` throughout the app is safe on all builds.
 */

import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

let initialised = false;

export function initSentry(): void {
  if (initialised) return;
  if (__DEV__) return; // dev — see docstring
  if (!DSN) return;    // no DSN configured — skip silently

  Sentry.init({
    dsn: DSN,
    // 1-in-4 sample of transactions keeps us under the free-tier ceiling
    // even at heavy usage. Errors are always captured, only perf traces
    // are sampled.
    tracesSampleRate: 0.25,
    // Native crashes go through the OS crash reporter; RN JS errors
    // funnel through this SDK. Both attach the same session/user info.
    enableAppHangTracking: true,
    // Do NOT send request/response bodies — bearer tokens would leak.
    sendDefaultPii: false,
    beforeSend(event) {
      // Extra safety net: strip any Authorization header that snuck in
      // via a breadcrumb.
      if (event.breadcrumbs) {
        for (const b of event.breadcrumbs) {
          if (b.data && typeof b.data === 'object') {
            const d = b.data as Record<string, unknown>;
            delete d.Authorization;
            delete d.authorization;
            delete d.access_token;
            delete d.refresh_token;
          }
        }
      }
      return event;
    },
  });
  initialised = true;
}

/** Attach the currently signed-in user so crashes are grouped by account. */
export function identifySentryUser(user: { id: string; email: string } | null): void {
  if (!initialised) return;
  if (user) {
    Sentry.setUser({ id: user.id, email: user.email });
  } else {
    Sentry.setUser(null);
  }
}

/** Send a caught exception. Safe to call in dev — becomes a no-op. */
export function reportError(err: unknown, context?: Record<string, unknown>): void {
  if (!initialised) {
    // In dev, still print so we don't silently swallow.
    if (__DEV__) console.error('[reportError]', err, context);
    return;
  }
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
