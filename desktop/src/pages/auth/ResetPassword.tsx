import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import { KeyRound } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ApiError } from '@/lib/api';
import { resetPassword } from '@/lib/auth-api';

interface FormValues {
  token: string;
  new_password: string;
  confirm: string;
}

export function ResetPassword(): JSX.Element {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      token: search.get('token') ?? '',
      new_password: '',
      confirm: '',
    },
  });

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(values: FormValues): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(values.token.trim(), values.new_password);
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 1200);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server. Try again.');
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
            <KeyRound className="h-5 w-5 text-white" />
          </span>
          <div>
            <div className="text-lg font-semibold tracking-tight text-white">Set a new password</div>
            <div className="text-xs text-slate-500">Paste your reset token and choose a password</div>
          </div>
        </div>

        {done ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            Password updated. Redirecting to sign in…
          </div>
        ) : (
          <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
            <Input
              label="Reset token"
              hint="Paste the token from the reset link"
              error={errors.token?.message}
              {...register('token', { required: 'Reset token is required' })}
            />
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              error={errors.new_password?.message}
              {...register('new_password', {
                required: 'Choose a password',
                minLength: { value: 8, message: 'Use at least 8 characters' },
              })}
            />
            <Input
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              error={errors.confirm?.message}
              {...register('confirm', {
                validate: (v) => v === watch('new_password') || 'Passwords do not match',
              })}
            />
            {error && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </div>
            )}
            <Button type="submit" size="lg" className="w-full" loading={submitting}>
              Update password
            </Button>
            <Link to="/login" className="block text-center text-xs text-slate-500 hover:text-slate-200">
              Back to sign in
            </Link>
          </form>
        )}
      </motion.div>
    </div>
  );
}
