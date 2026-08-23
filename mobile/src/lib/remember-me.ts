/**
 * "Remember me" credential storage — React Native / Expo edition.
 *
 * Backed by `expo-secure-store`, which delegates to:
 *   - iOS: Keychain (protected by the device passcode / Face ID / Touch ID)
 *   - Android: EncryptedSharedPreferences + Android Keystore (protected by
 *     the device lockscreen)
 *
 * The device unlock IS the "verify with the device owner" step in the
 * product spec — the Keystore only surrenders the key to a process running
 * as the user after the device has been unlocked at least once since boot.
 * That's a stronger security posture than the desktop story because the
 * mobile OS enforces it at the hardware level (Titan M on Pixel, Secure
 * Enclave on iPhone).
 *
 * We store BOTH email + password so the pilot user can bill with a single
 * tap after the first login. The second factor (TOTP or emailed OTP) is
 * still applied server-side on every login, so a stolen phone that a
 * thief has already unlocked would still hit the OTP gate.
 *
 * Key names are namespaced with `retailos:` so a shared-tenant EAS build
 * never trips over another app's SecureStore entries.
 */

import * as SecureStore from 'expo-secure-store';

const EMAIL_KEY = 'retailos:remember_email';
const PASSWORD_KEY = 'retailos:remember_password';

// SecureStore options: require the device to be unlocked at least once
// since last boot before we can read. `AFTER_FIRST_UNLOCK` matches the
// user's expectation ("phone that's been powered on and unlocked once
// today") without prompting for the passcode on every read.
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export async function saveRememberedCredentials(
  email: string,
  password: string,
): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(EMAIL_KEY, email, STORE_OPTIONS),
    SecureStore.setItemAsync(PASSWORD_KEY, password, STORE_OPTIONS),
  ]);
}

export async function loadRememberedCredentials(): Promise<
  { email: string; password: string } | null
> {
  const [email, password] = await Promise.all([
    SecureStore.getItemAsync(EMAIL_KEY, STORE_OPTIONS),
    SecureStore.getItemAsync(PASSWORD_KEY, STORE_OPTIONS),
  ]);
  if (!email || !password) return null;
  return { email, password };
}

export async function clearRememberedCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(EMAIL_KEY),
    SecureStore.deleteItemAsync(PASSWORD_KEY),
  ]);
}

/**
 * True when SecureStore is available on this device. Almost always true on
 * real hardware; can be false in unusual emulator setups. Drives the
 * "Secured / Fallback" badge on the login form so the user can see whether
 * their credentials are actually protected before turning Remember on.
 */
export async function isRememberMeSecure(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}
