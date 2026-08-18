import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import { LogIn, Mail, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ApiError } from '@/lib/api';
import { login, login2fa } from '@/lib/auth-api';
import { useAuthStore } from '@/stores/auth-store';

interface CredentialForm {
  email: string;
  password: string;
}

interface CodeForm {
  code: string;
}

export function Login(): JSX.Element {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CredentialForm>({ defaultValues: { email: '', password: '' } });

  const codeForm = useForm<CodeForm>({ defaultValues: { code: '' } });

  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    if (status === 'idle') void bootstrap();
    if (status === 'authenticated') navigate('/dashboard', { replace: true });
  }, [status, bootstrap, navigate]);

  async function onSubmitCredentials(values: CredentialForm): Promise<void> {
    setServerError(null);
    setSubmitting(true);
    try {
      const res = await login(values.email.trim(), values.password);
      if (res.requires_2fa && res.challenge_token) {
        setChallengeToken(res.challenge_token);
      } else if (res.tokens && res.user) {
        setSession(res.tokens, res.user);
        const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
        navigate(from, { replace: true });
      } else {
        setServerError('Unexpected login response.');
      }
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : 'Unable to reach the server. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitCode(values: CodeForm): Promise<void> {
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
      setServerError(
        err instanceof ApiError ? err.message : 'Code did not verify.',
      );
    } finally {
      setSubmitting(false);
    }
  }

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
              {challengeToken ? 'Two-factor verification' : 'Sign in to continue'}
            </div>
          </div>
        </div>

        {challengeToken ? (
          <form
            className="space-y-5"
            onSubmit={codeForm.handleSubmit(onSubmitCode)}
            noValidate
          >
            <p className="text-sm text-slate-400">
              Open your authenticator app and enter the current 6-digit code for
              this account.
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
              onClick={() => {
                setChallengeToken(null);
                setServerError(null);
                codeForm.reset();
              }}
              className="w-full text-center text-xs text-slate-500 hover:text-slate-200"
            >
              Use a different account
            </button>
          </form>
        ) : (
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
