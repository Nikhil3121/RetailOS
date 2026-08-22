/**
 * Over-the-air (OTA) updates via expo-updates.
 *
 * Ships bug fixes without a Play Store review. On app boot:
 *   1. Silently check EAS Update for a newer JS bundle for our runtime.
 *   2. If one exists, download it in the background.
 *   3. Once downloaded, apply it — either immediately if we haven't
 *      shown UI yet, or on next cold start (so a running bill flow is
 *      never interrupted).
 *
 * OTA cannot ship native-code changes — those still require a rebuild
 * via `eas build --profile production`. Bump `runtimeVersion` in
 * app.json when native deps change so old clients stop receiving new JS.
 */

import * as Updates from 'expo-updates';

/**
 * Called once at app boot from App.tsx. Non-blocking — never delays first
 * paint. Errors are swallowed silently (a failed OTA check must never
 * prevent the app from starting).
 */
export async function checkForOtaUpdate(): Promise<void> {
  // Dev bundles are served by Metro — expo-updates isn't active there.
  if (__DEV__) return;
  if (!Updates.isEnabled) return;

  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return;

    await Updates.fetchUpdateAsync();
    // Apply on next cold start rather than mid-session — a shopkeeper
    // in the middle of a bill would otherwise see the app suddenly
    // restart. Updates.reloadAsync() is a knob we can pull if a fix
    // is critical enough to interrupt.
  } catch {
    // Silent — network was down, backend was flaky, whatever. The
    // update will be picked up on the next boot.
  }
}
