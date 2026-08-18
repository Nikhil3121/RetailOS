import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import { CheckCircle2, KeyRound, Mail } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ApiError } from '@/lib/api';
import { forgotPassword } from '@/lib/auth-api';

interface FormValues {
  email: string;
}

export function ForgotPassword(): JSX.Element {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { email: '' } });

  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<{ message: string; debugToken: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(values: FormValues): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const res = await forgotPassword(values.email.trim());
      setSent({ message: res.message, debugToken: res.debug_reset_token });
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
            <div className="text-lg font-semibold tracking-tight text-white">Forgot password</div>
            <div className="text-xs text-slate-500">We'll email you a reset link</div>
          </div>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{sent.message}</span>
            </div>
            {sent.debugToken && (
              <div className="rounded-xl border border-border bg-white/[0.02] p-3 text-xs">
                <div className="mb-1 font-medium uppercase tracking-wider text-slate-400">
                  Dev-mode reset token
                </div>
                <code className="block break-all font-mono text-slate-200">{sent.debugToken}</code>
                <p className="mt-2 text-slate-500">
                  SMTP isn't configured, so the reset token is shown here instead of being
                  emailed. Set the SMTP env vars on the server to deliver it via email.
                </p>
                <Link
                  to={`/reset-password?token=${encodeURIComponent(sent.debugToken)}`}
                  className="mt-3 inline-block text-cobalt-300 hover:text-cobalt-200"
                >
                  → Use this token to set a new password
                </Link>
              </div>
            )}
            <Link to="/login" className="block text-center text-xs text-slate-500 hover:text-slate-200">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
            <Input
              label="Email"
              type="email"
              autoFocus
              leadingIcon={<Mail className="h-4 w-4" />}
              error={errors.email?.message}
              {...register('email', {
                required: 'Email is required',
                pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' },
              })}
            />
            {error && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </div>
            )}
            <Button type="submit" size="lg" className="w-full" loading={submitting}>
              Send reset link
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
