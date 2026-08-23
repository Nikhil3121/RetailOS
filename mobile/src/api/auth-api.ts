/**
 * Typed endpoint clients for /api/v1/auth/*.
 * Same shapes as desktop/src/lib/auth-api.ts.
 */

import { apiRequest } from '@/api/api';
import type { CurrentUser, TokenPair } from '@/types/auth';

export interface LoginResponse {
  requires_2fa: boolean;
  /**
   * True when the server has `login_otp_required=true` AND the user is
   * NOT enrolled in TOTP. Populated alongside `challenge_token` and
   * `otp_expires_in`; caller must POST /auth/login/otp to finish.
   */
  requires_otp: boolean;
  challenge_token: string | null;
  otp_expires_in: number | null;
  tokens: TokenPair | null;
  user: CurrentUser | null;
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>({
    path: '/auth/login',
    method: 'POST',
    body: { email, password },
    auth: false,
  });
}

export function login2fa(
  challengeToken: string,
  code: string,
): Promise<LoginResponse> {
  return apiRequest<LoginResponse>({
    path: '/auth/login/2fa',
    method: 'POST',
    body: { challenge_token: challengeToken, code },
    auth: false,
  });
}

/**
 * Second step of an email-OTP-gated login. See desktop/src/lib/auth-api.ts
 * for the full docstring — the two clients call an identical endpoint and
 * behave identically on error (401 for wrong code OR expired token).
 */
export function loginOtp(
  challengeToken: string,
  code: string,
): Promise<LoginResponse> {
  return apiRequest<LoginResponse>({
    path: '/auth/login/otp',
    method: 'POST',
    body: { challenge_token: challengeToken, code },
    auth: false,
  });
}

export function refreshTokens(refreshToken: string): Promise<TokenPair> {
  return apiRequest<TokenPair>({
    path: '/auth/refresh',
    method: 'POST',
    body: { refresh_token: refreshToken },
    auth: false,
  });
}

export function logout(refreshToken: string): Promise<void> {
  return apiRequest<void>({
    path: '/auth/logout',
    method: 'POST',
    body: { refresh_token: refreshToken },
    auth: false,
  });
}

export function fetchMe(): Promise<CurrentUser> {
  return apiRequest<CurrentUser>({ path: '/auth/me', method: 'GET' });
}
