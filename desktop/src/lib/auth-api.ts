/**
 * Typed endpoint clients for `/api/v1/auth/*`.
 * Kept in a separate file from the low-level fetcher so imports stay short.
 */
import { apiRequest } from '@/lib/api';
import { storeElevation } from '@/lib/elevation';
import type { CurrentUser, TokenPair } from '@/types/auth';

export interface LoginResponse {
  requires_2fa: boolean;
  challenge_token: string | null;
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

export interface TwoFactorStatus {
  enabled: boolean;
}

export interface TwoFactorSetupResponse {
  secret: string;
  provisioning_uri: string;
}

export function twoFactorStatus(): Promise<TwoFactorStatus> {
  return apiRequest<TwoFactorStatus>({ path: '/auth/2fa/status', method: 'GET' });
}

export function twoFactorSetup(): Promise<TwoFactorSetupResponse> {
  return apiRequest<TwoFactorSetupResponse>({
    path: '/auth/2fa/setup',
    method: 'POST',
  });
}

export function twoFactorVerify(code: string): Promise<void> {
  return apiRequest<void>({
    path: '/auth/2fa/verify',
    method: 'POST',
    body: { code },
  });
}

export function twoFactorDisable(
  currentPassword: string,
  code: string,
): Promise<void> {
  return apiRequest<void>({
    path: '/auth/2fa/disable',
    method: 'POST',
    body: { current_password: currentPassword, code },
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

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return apiRequest<void>({
    path: '/auth/change-password',
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
  });
}

export interface ForgotPasswordResponse {
  message: string;
  debug_reset_token: string | null;
}

export function forgotPassword(email: string): Promise<ForgotPasswordResponse> {
  return apiRequest<ForgotPasswordResponse>({
    path: '/auth/forgot-password',
    method: 'POST',
    body: { email },
    auth: false,
  });
}

export function resetPassword(resetToken: string, newPassword: string): Promise<void> {
  return apiRequest<void>({
    path: '/auth/reset-password',
    method: 'POST',
    body: { reset_token: resetToken, new_password: newPassword },
    auth: false,
  });
}

// ---------------------------------------------------------------------------
// Re-authentication for destructive actions
// ---------------------------------------------------------------------------

interface ElevationResponse {
  elevation_token: string;
  expires_in_seconds: number;
}

/**
 * Confirm the signed-in user's own password, unlocking deletes and voids for a
 * few minutes.
 *
 * Throws `ApiError` when the password is wrong, so the caller can show the
 * server's own message. Nothing here decides whether a password is correct —
 * the server holds the hash and is the only thing entitled to answer.
 */
export async function confirmPassword(password: string): Promise<void> {
  const res = await apiRequest<ElevationResponse>({
    path: '/auth/verify-password',
    method: 'POST',
    body: { password },
  });
  storeElevation(res.elevation_token, res.expires_in_seconds);
}
