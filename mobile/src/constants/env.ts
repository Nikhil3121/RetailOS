/**
 * Runtime environment values. Set via Expo's `.env` file (only vars prefixed
 * `EXPO_PUBLIC_` are exposed to the client bundle) and read at build time.
 */

export const API_BASE_URL =
  (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '') ||
  'https://retailos-backend-8jwi.onrender.com';

export const API_V1 = `${API_BASE_URL}/api/v1`;
