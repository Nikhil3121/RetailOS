/**
 * LoginScreen — matches the design system: aurora backdrop, glass card,
 * gradient primary button. Same auth flow as before.
 */

import type React from 'react';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';

// __DEV__ is React Native's global build-time flag — true in Metro dev
// builds, false in `npx expo export` / EAS release builds. Dev-gate the
// pre-filled test credential so production APKs start clean and the
// pilot's owner email isn't shipped to real users.
const DEV_EMAIL = __DEV__ ? 'owner@msmall.retailos.dev' : '';

import { ApiError } from '@/api/api';
import { login } from '@/api/auth-api';
import { Button } from '@/components/Button';
import { GlassCard } from '@/components/GlassCard';
import { Input } from '@/components/Input';
import { Logo } from '@/components/Logo';
import { colors, radius } from '@/constants/theme';
import { useAuthStore } from '@/stores/auth-store';

export function LoginScreen(): React.JSX.Element {
  const setSession = useAuthStore((s) => s.setSession);

  const [email, setEmail] = useState(DEV_EMAIL);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);

  async function onSubmit(): Promise<void> {
    setError(null);
    setLoading(true);
    try {
      const res = await login(email.trim().toLowerCase(), password);
      if (res.requires_2fa) {
        setError('2FA required — mobile 2FA flow is not yet wired.');
        return;
      }
      if (!res.tokens || !res.user) {
        setError('Login succeeded but the server returned no session.');
        return;
      }
      setSession(res.tokens, res.user);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
      else setError('Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

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
          <Text style={styles.brandTag}>Sign in to continue</Text>
        </View>

        <GlassCard>
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
              onSubmitEditing={onSubmit}
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

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Button
              label="Sign in"
              onPress={onSubmit}
              disabled={!canSubmit}
              loading={loading}
              size="lg"
            />
          </View>
        </GlassCard>

        <Text style={styles.footer}>
          Backend · retailos-backend-8jwi.onrender.com
        </Text>
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
  brand: {
    alignItems: 'center',
    gap: 10,
  },
  brandName: {
    color: colors.slate200,
    fontSize: 28,
    fontWeight: '500',
    letterSpacing: -0.6,
    marginTop: 4,
  },
  brandNameBold: {
    color: colors.white,
    fontWeight: '700',
  },
  brandTag: {
    color: colors.slate400,
    fontSize: 13,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: 'rgba(244,63,94,0.3)',
    backgroundColor: 'rgba(244,63,94,0.1)',
    borderRadius: radius.xl,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    color: colors.rose300,
    fontSize: 13,
  },
  footer: {
    color: colors.slate600,
    fontSize: 11,
    textAlign: 'center',
  },
});
