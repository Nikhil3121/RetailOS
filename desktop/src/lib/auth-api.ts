/**
 * Typed endpoint clients for `/api/v1/auth/*`.
 * Kept in a separate file from the low-level fetcher so imports stay short.
 */
import { apiRequest } from '@/lib/api';
import type { CurrentUser, TokenPair } from '@/types/auth';

export interface LoginResponse {
  requires_2fa: boolean;
  /**
   * True when the server is configured to gate logins behind an emailed
   * 6-digit code (`login_otp_required=true`) AND the user does not have
   * TOTP enrolled. TOTP wins if both would fire.
   */
  requires_otp: boolean;
  challenge_token: string | null;
  /**
   * Seconds until the OTP challenge JWT expires. Populated only when
   * `requires_otp=true`. Drives the countdown in the OTP screen.
   */
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
 * Second step of an email-OTP-gated login. Presents the challenge_token
 * received from /auth/login + the 6-digit code the user typed from the
 * OTP email. Returns the same LoginResponse shape as /auth/login, but
 * with `tokens` + `user` populated (or a 401 if the code was wrong /
 * the challenge expired — the two errors are deliberately identical to
 * prevent an attacker distinguishing "still guessing" from "start over").
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
