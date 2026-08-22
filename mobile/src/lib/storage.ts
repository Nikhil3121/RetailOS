/**
 * Thin wrapper around AsyncStorage that exposes the same shape as the web's
 * localStorage API. Lets code ported from the desktop app work unchanged.
 *
 * Note: AsyncStorage is async by nature (I/O, not a synchronous JS-side
 * lookup). We expose async methods only — if a desktop utility needed a
 * synchronous `localStorage.getItem()`, it must be rewritten for RN.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const storage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      // Best-effort — swallow so the caller isn't forced to try/catch.
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Same as above.
    }
  },
};
