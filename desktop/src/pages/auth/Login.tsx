/**
 * Login screen.
 *
 * Two sequential stages, driven by whatever the backend returns from
 * /auth/login:
 *
 *   1. `credentials` — email + password. If backend flags requires_2fa
 *                      we advance to the twofa stage. Otherwise tokens
 *                      land and we route to /dashboard.
 *   2. `twofa`       — TOTP code for users with an authenticator enrolled.
 *
 * Extra protections layered onto stage 1:
 *
 *   - **Math CAPTCHA**: after 3 consecutive failed credential submits,
 *     a fresh arithmetic prompt renders inline. Regenerates on every
 *     wrong answer (per product spec: "it should change automatically
 *     after a wrong attempt"). Cleared once the user successfully
 *     advances past the credentials stage.
 *   - **Remember me**: opt-in checkbox that persists email + password
 *     via Electron safeStorage (falls back to localStorage with a loud
 *     warning if the bridge is not present — see lib/remember-me.ts).
 *     The stored password never leaves the machine.
 */

import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import { Calculator, LogIn, Mail, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ApiError } from '@/lib/api';
import { login, login2fa } from '@/lib/auth-api';
import { generateMathCaptcha, type MathCaptcha, verifyMathCaptcha } from '@/lib/math-captcha';
import {
  clearRememberedCredentials,
  isRememberMeSecure,
  loadRememberedCredentials,
  saveRememberedCredentials,
} from '@/lib/remember-me';
import { useAuthStore } from '@/stores/auth-store';

// Show a math CAPTCHA once the caller has burnt this many login attempts.
// 3 is friendly (real users typo their password once or twice) but
// aggressive enough to stop bots from getting an infinite guess budget.
const CAPTCHA_AFTER_FAILED_ATTEMPTS = 3;

type Stage = 'credentials' | 'twofa';

interface CredentialForm {
  email: string;
  password: string;
  remember: boolean;
  captchaAnswer: string;
}

interface CodeForm {
  code: string;
}

export function Login(): JSX.Element {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setFocus,
    watch,
    formState: { errors },
  } = useForm<CredentialForm>({
    defaultValues: { email: '', password: '', remember: false, captchaAnswer: '' },
  });

  const codeForm = useForm<CodeForm>({ defaultValues: { code: '' } });

  const [stage, setStage] = useState<Stage>('credentials');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Failed-attempt counter drives the CAPTCHA gate. Kept in state (not
  // sessionStorage) so a page reload gives a clean slate — attackers who
  // reload lose their unbounded guessing budget; genuine users who reload
  // just get a fresh form.
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [captcha, setCaptcha] = useState<MathCaptcha | null>(null);

  // "Remember me" secure-vs-fallback badge.
  const [rememberSecure, setRememberSecure] = useState<boolean>(false);

  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    if (status === 'idle') void bootstrap();
    if (status === 'authenticated') navigate('/dashboard', { replace: true });
  }, [status, bootstrap, navigate]);

  // Preload any remembered credentials once on mount. If present, tick the
  // Remember box on and pre-fill both fields so the user just hits Enter.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [stored, secure] = await Promise.all([
        loadRememberedCredentials(),
        isRememberMeSecure(),
      ]);
      if (cancelled) return;
      setRememberSecure(secure);
      if (stored) {
        setValue('email', stored.email);
        setValue('password', stored.password);
        setValue('remember', true);
        // Focus the sign-in button implicitly by focusing password (Enter
        // submits). Avoids the "why is the cursor in an empty box" glitch.
        setFocus('password');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setValue, setFocus]);

  const needsCaptcha = failedAttempts >= CAPTCHA_AFTER_FAILED_ATTEMPTS;

  // Ensure a CAPTCHA exists as soon as the threshold is crossed, and drop
  // it (with a fresh one queued) if the user clears their attempt count.
  useEffect(() => {
    if (needsCaptcha && !captcha) setCaptcha(generateMathCaptcha());
    if (!needsCaptcha && captcha) setCaptcha(null);
  }, [needsCaptcha, captcha]);

  async function persistOrForgetCredentials(
    email: string,
    password: string,
    remember: boolean,
  ): Promise<void> {
    // Only persist on a successful login — otherwise a wrong-password typo
    // would overwrite a valid remembered pair with garbage.
    if (remember) {
      await saveRememberedCredentials(email, password);
    } else {
      await clearRememberedCredentials();
    }
  }

  async function onSubmitCredentials(values: CredentialForm): Promise<void> {
    setServerError(null);

    // Client-side CAPTCHA gate. Runs BEFORE the network round-trip so the
    // backend rate-limiter never sees a bot's spam.
    if (needsCaptcha) {
      if (!captcha || !verifyMathCaptcha(captcha, values.captchaAnswer)) {
        setServerError('That answer is not correct. Please try again.');
        // Regenerate on every wrong answer per product spec.
        setCaptcha(generateMathCaptcha());
        setValue('captchaAnswer', '');
        return;
      }
    }

    setSubmitting(true);
    try {
      const email = values.email.trim();
      const res = await login(email, values.password);

      if (res.requires_2fa && res.challenge_token) {
        setChallengeToken(res.challenge_token);
        setStage('twofa');
        // Password was correct — clear counters + captcha before advancing.
        setFailedAttempts(0);
        setCaptcha(null);
        // Persist NOW: password verified, only the second factor remains.
        await persistOrForgetCredentials(email, values.password, values.remember);
        return;
      }

      if (res.tokens && res.user) {
        await persistOrForgetCredentials(email, values.password, values.remember);
        setSession(res.tokens, res.user);
        const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
        navigate(from, { replace: true });
        return;
      }

      setServerError('Unexpected login response.');
    } catch (err) {
      setFailedAttempts((n) => n + 1);
      // Fresh CAPTCHA on any failure once we're past the threshold, so the
      // attacker never gets to keep guessing the same prompt.
      if (needsCaptcha || failedAttempts + 1 >= CAPTCHA_AFTER_FAILED_ATTEMPTS) {
        setCaptcha(generateMathCaptcha());
        setValue('captchaAnswer', '');
      }
      setServerError(
        err instanceof ApiError ? err.message : 'Unable to reach the server. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitTwoFa(values: CodeForm): Promise<void> {
    if (!challengeToken) return;
    setServerError(null);
    setSubmitting(true);
    try {
      const res = await login2fa(challengeToken, values.code.trim());
      if (res.tokens && res.user) {
        setSession(res.tokens, res.user);
        const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
        navigate(from, { replace: true });
      } else {
        setServerError('Unexpected 2FA response.');
      }
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Code did not verify.');
    } finally {
      setSubmitting(false);
    }
  }

  function backToCredentials(): void {
    setStage('credentials');
    setChallengeToken(null);
    setServerError(null);
    codeForm.reset();
    reset({
      email: watch('email'),
      password: '',
      remember: watch('remember'),
      captchaAnswer: '',
    });
  }

  const rememberChecked = watch('remember');

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-950 px-6 py-12">
      <div className="pointer-events-none absolute inset-0 grid-overlay opacity-60" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
        className="glass-strong relative w-full max-w-md p-10"
      >
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cobalt-500 to-cobalt-800 shadow-glow">
            <ShieldCheck className="h-5 w-5 text-white" />
          </span>
          <div>
            <div className="text-lg font-semibold tracking-tight text-white">RetailOS</div>
            <div className="text-xs text-slate-500">
              {stage === 'twofa' ? 'Two-factor verification' : 'Sign in to continue'}
            </div>
          </div>
        </div>

        {stage === 'twofa' && (
          <form className="space-y-5" onSubmit={codeForm.handleSubmit(onSubmitTwoFa)} noValidate>
            <p className="text-sm text-slate-400">
              Open your authenticator app and enter the current 6-digit code
              for this account.
            </p>
            <Input
              label="Authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123 456"
              error={codeForm.formState.errors.code?.message}
              {...codeForm.register('code', {
                required: 'Code is required',
                minLength: { value: 6, message: '6 digits' },
                maxLength: { value: 8, message: 'Too long' },
              })}
            />
            {serverError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {serverError}
              </div>
            )}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={submitting}
              leadingIcon={<ShieldCheck className="h-4 w-4" />}
            >
              Verify & continue
            </Button>
            <button
              type="button"
              onClick={backToCredentials}
              className="w-full text-center text-xs text-slate-500 hover:text-slate-200"
            >
              Use a different account
            </button>
          </form>
        )}

        {stage === 'credentials' && (
          <form
            className="space-y-5"
            onSubmit={handleSubmit(onSubmitCredentials)}
            noValidate
          >
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              autoFocus
              leadingIcon={<Mail className="h-4 w-4" />}
              error={errors.email?.message}
              {...register('email', {
                required: 'Email is required',
                pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' },
              })}
            />

            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              error={errors.password?.message}
              {...register('password', { required: 'Password is required' })}
            />

            {needsCaptcha && captcha && (
              <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-amber-200">
                  <Calculator className="h-4 w-4" />
                  Quick check — solve the problem below to continue.
                </div>
                <div className="flex items-center gap-3">
                  <div className="min-w-[6.5rem] rounded-lg bg-ink-900/70 px-3 py-2 text-center font-mono text-lg tracking-wide text-white">
                    {captcha.prompt} = ?
                  </div>
                  <Input
                    label=""
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Answer"
                    error={errors.captchaAnswer?.message}
                    {...register('captchaAnswer', {
                      required: 'Answer is required',
                    })}
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  The problem changes after every wrong answer.
                </p>
              </div>
            )}

            <label className="flex items-center justify-between text-sm text-slate-300">
              <span className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-cobalt-500"
                  {...register('remember')}
                />
                Remember me on this device
              </span>
              {rememberChecked && (
                <span
                  className={
                    rememberSecure
                      ? 'text-[11px] font-medium text-emerald-300'
                      : 'text-[11px] font-medium text-amber-300'
                  }
                  title={
                    rememberSecure
                      ? 'Credentials will be stored in your OS keychain and unlocked with your device passcode.'
                      : 'Secure keychain unavailable — credentials will be stored in plaintext localStorage. Only use for local testing.'
                  }
                >
                  {rememberSecure ? '🔒 Secured' : '⚠ Fallback'}
                </span>
              )}
            </label>

            {serverError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {serverError}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={submitting}
              leadingIcon={<LogIn className="h-4 w-4" />}
            >
              Sign in
            </Button>

            <div className="text-center text-xs text-slate-500">
              <Link to="/forgot-password" className="hover:text-slate-200">
                Forgot your password?
              </Link>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}
