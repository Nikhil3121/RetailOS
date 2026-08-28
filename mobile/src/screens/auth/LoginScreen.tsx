/**
 * LoginScreen — mobile.
 *
 * Two sequential stages, driven by whatever the backend returns from
 * /auth/login:
 *
 *   1. `credentials` — email + password.
 *   2. `twofa`       — TOTP code for users with an authenticator enrolled.
 *
 * Extra protections on stage 1:
 *   - Math CAPTCHA after 3 failed submits, regenerates on every wrong
 *     answer (mirrors desktop).
 *   - "Remember me" — persists email + password via expo-secure-store
 *     (backed by iOS Keychain / Android EncryptedSharedPreferences +
 *     Android Keystore). Device unlock IS the "device owner" gate.
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Eye, EyeOff, Calculator, ShieldCheck } from 'lucide-react-native';

import { ApiError } from '@/api/api';
import { login, login2fa } from '@/api/auth-api';
import { Button } from '@/components/Button';
import { GlassCard } from '@/components/GlassCard';
import { Input } from '@/components/Input';
import { Logo } from '@/components/Logo';
import { API_BASE_URL } from '@/constants/env';
import { colors, radius } from '@/constants/theme';
import {
  clearRememberedCredentials,
  isRememberMeSecure,
  loadRememberedCredentials,
  saveRememberedCredentials,
} from '@/lib/remember-me';
import {
  generateMathCaptcha,
  type MathCaptcha,
  verifyMathCaptcha,
} from '@/lib/math-captcha';
import { useAuthStore } from '@/stores/auth-store';

const CAPTCHA_AFTER_FAILED_ATTEMPTS = 3;

type Stage = 'credentials' | 'twofa';

export function LoginScreen(): React.JSX.Element {
  const setSession = useAuthStore((s) => s.setSession);

  const [stage, setStage] = useState<Stage>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  const [remember, setRemember] = useState(false);
  const [rememberSecure, setRememberSecure] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [failedAttempts, setFailedAttempts] = useState(0);
  const [captcha, setCaptcha] = useState<MathCaptcha | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  // Preload remembered credentials once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [stored, secure] = await Promise.all([
        loadRememberedCredentials().catch(() => null),
        isRememberMeSecure().catch(() => false),
      ]);
      if (cancelled) return;
      setRememberSecure(secure);
      if (stored) {
        setEmail(stored.email);
        setPassword(stored.password);
        setRemember(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const needsCaptcha = failedAttempts >= CAPTCHA_AFTER_FAILED_ATTEMPTS;
  useEffect(() => {
    if (needsCaptcha && !captcha) setCaptcha(generateMathCaptcha());
    if (!needsCaptcha && captcha) setCaptcha(null);
  }, [needsCaptcha, captcha]);

  async function persistOrForget(): Promise<void> {
    try {
      if (remember) {
        await saveRememberedCredentials(email.trim().toLowerCase(), password);
      } else {
        await clearRememberedCredentials();
      }
    } catch (err) {
      // Non-fatal: the login itself succeeded. Log for diagnostics but
      // don't block the user from getting into the app.
      // eslint-disable-next-line no-console
      console.warn('[RetailOS] remember-me persistence failed', err);
    }
  }

  async function onSubmitCredentials(): Promise<void> {
    setError(null);

    if (needsCaptcha) {
      if (!captcha || !verifyMathCaptcha(captcha, captchaAnswer)) {
        setError('That answer is not correct. Please try again.');
        setCaptcha(generateMathCaptcha());
        setCaptchaAnswer('');
        return;
      }
    }

    setLoading(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();
      const res = await login(trimmedEmail, password);

      if (res.requires_2fa && res.challenge_token) {
        setChallengeToken(res.challenge_token);
        setStage('twofa');
        setCode('');
        setFailedAttempts(0);
        setCaptcha(null);
        await persistOrForget();
        return;
      }

      if (!res.tokens || !res.user) {
        setError('Login succeeded but the server returned no session.');
        return;
      }

      await persistOrForget();
      setSession(res.tokens, res.user);
    } catch (err) {
      setFailedAttempts((n) => n + 1);
      if (needsCaptcha || failedAttempts + 1 >= CAPTCHA_AFTER_FAILED_ATTEMPTS) {
        setCaptcha(generateMathCaptcha());
        setCaptchaAnswer('');
      }
      if (err instanceof ApiError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
      else setError('Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitTwoFa(): Promise<void> {
    if (!challengeToken) return;
    setError(null);
    setLoading(true);
    try {
      const res = await login2fa(challengeToken, code.trim());
      if (!res.tokens || !res.user) {
        setError('Verification succeeded but no session was returned.');
        return;
      }
      setSession(res.tokens, res.user);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
      else setError('Code did not verify.');
    } finally {
      setLoading(false);
    }
  }

  function backToCredentials(): void {
    setStage('credentials');
    setChallengeToken(null);
    setCode('');
    setError(null);
  }

  const canSubmitCredentials =
    email.trim().length > 0 && password.length > 0 && !loading;
  const canSubmitCode = code.trim().length >= 6 && !loading;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Logo size={72} />
          <Text style={styles.brandName}>
            Retail<Text style={styles.brandNameBold}>OS</Text>
          </Text>
          <Text style={styles.brandTag}>
            {stage === 'twofa' ? 'Two-factor verification' : 'Sign in to continue'}
          </Text>
        </View>

        <GlassCard>
          {stage === 'credentials' && (
            <View style={{ gap: 14 }}>
              <Input
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                spellCheck={false}
                keyboardType="email-address"
                textContentType="username"
                placeholder="you@example.com"
              />
              <Input
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                spellCheck={false}
                textContentType="password"
                placeholder="Enter password"
                onSubmitEditing={onSubmitCredentials}
                hint="Tap the eye to verify what you typed."
                trailingIcon={
                  <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={8}>
                    {showPw ? (
                      <EyeOff size={18} color={colors.slate400} />
                    ) : (
                      <Eye size={18} color={colors.slate400} />
                    )}
                  </Pressable>
                }
              />

              {needsCaptcha && captcha && (
                <View style={styles.captchaBox}>
                  <View style={styles.captchaHeader}>
                    <Calculator size={16} color={colors.amber300} />
                    <Text style={styles.captchaHeaderText}>
                      Quick check — solve to continue
                    </Text>
                  </View>
                  <View style={styles.captchaRow}>
                    <View style={styles.captchaPrompt}>
                      <Text style={styles.captchaPromptText}>
                        {captcha.prompt} = ?
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Input
                        label=""
                        value={captchaAnswer}
                        onChangeText={setCaptchaAnswer}
                        keyboardType="number-pad"
                        placeholder="Answer"
                      />
                    </View>
                  </View>
                  <Text style={styles.captchaHint}>
                    The problem changes after every wrong answer.
                  </Text>
                </View>
              )}

              <Pressable
                onPress={() => setRemember((v) => !v)}
                style={styles.rememberRow}
                hitSlop={8}
              >
                <View style={styles.rememberLeft}>
                  <View
                    style={[
                      styles.checkbox,
                      remember && styles.checkboxChecked,
                    ]}
                  >
                    {remember && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={styles.rememberLabel}>
                    Remember me on this device
                  </Text>
                </View>
                {remember && (
                  <Text
                    style={
                      rememberSecure ? styles.badgeSecure : styles.badgeFallback
                    }
                  >
                    {rememberSecure ? '🔒 Secured' : '⚠ Not secured'}
                  </Text>
                )}
              </Pressable>

              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <Button
                label="Sign in"
                onPress={onSubmitCredentials}
                disabled={!canSubmitCredentials}
                loading={loading}
                size="lg"
              />
            </View>
          )}

          {stage === 'twofa' && (
            <View style={{ gap: 14 }}>
              <View style={styles.stageHeader}>
                <ShieldCheck size={18} color={colors.slate200} />
                <Text style={styles.stageHeaderText}>
                  Open your authenticator app and enter the current 6-digit
                  code.
                </Text>
              </View>
              <Input
                label="Authenticator code"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                placeholder="123 456"
                maxLength={8}
              />
              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}
              <Button
                label="Verify & continue"
                onPress={onSubmitTwoFa}
                disabled={!canSubmitCode}
                loading={loading}
                size="lg"
              />
              <Pressable onPress={backToCredentials} hitSlop={8}>
                <Text style={styles.linkText}>Use a different account</Text>
              </Pressable>
            </View>
          )}
        </GlassCard>

        {__DEV__ && (
          <Text style={styles.footer}>Backend · {API_BASE_URL}</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 24,
  },
  brand: { alignItems: 'center', gap: 10 },
  brandName: {
    color: colors.slate200,
    fontSize: 28,
    fontWeight: '500',
    letterSpacing: -0.6,
    marginTop: 4,
  },
  brandNameBold: { color: colors.white, fontWeight: '700' },
  brandTag: { color: colors.slate400, fontSize: 13 },

  captchaBox: {
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
    backgroundColor: 'rgba(245,158,11,0.05)',
    borderRadius: radius.xl,
    padding: 12,
    gap: 8,
  },
  captchaHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  captchaHeaderText: {
    color: colors.amber300,
    fontSize: 12,
    fontWeight: '500',
  },
  captchaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  captchaPrompt: {
    minWidth: 96,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(5,7,13,0.7)',
    alignItems: 'center',
  },
  captchaPromptText: {
    color: colors.white,
    fontSize: 18,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  captchaHint: { color: colors.slate600, fontSize: 11 },

  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  rememberLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(148,163,184,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.cobalt500,
    borderColor: colors.cobalt500,
  },
  checkmark: { color: colors.white, fontSize: 13, fontWeight: '700' },
  rememberLabel: { color: colors.slate200, fontSize: 13 },
  badgeSecure: {
    color: colors.emerald300,
    fontSize: 11,
    fontWeight: '600',
  },
  badgeFallback: {
    color: colors.amber300,
    fontSize: 11,
    fontWeight: '600',
  },

  stageHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stageHeaderText: { color: colors.slate400, fontSize: 13, flex: 1 },

  linkText: {
    color: colors.slate500,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 4,
  },

  errorBox: {
    borderWidth: 1,
    borderColor: 'rgba(244,63,94,0.3)',
    backgroundColor: 'rgba(244,63,94,0.1)',
    borderRadius: radius.xl,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: { color: colors.rose300, fontSize: 13 },
  footer: { color: colors.slate600, fontSize: 11, textAlign: 'center' },
});
