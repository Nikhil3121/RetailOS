import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { ApiError } from '@/lib/api';
import { changePassword } from '@/lib/auth-api';
import { useAuthStore } from '@/stores/auth-store';

interface FormValues {
  current: string;
  next: string;
  confirm: string;
}

export function ChangePassword(): JSX.Element {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { current: '', next: '', confirm: '' } });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const logout = useAuthStore((s) => s.logout);

  async function onSubmit(values: FormValues): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await changePassword(values.current, values.next);
      setDone(true);
      reset();
      // Password change revokes all sessions server-side — bounce out so the
      // user reauthenticates cleanly with the new credential.
      setTimeout(() => void logout(), 900);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Change password</h1>
        <p className="mt-1 text-sm text-slate-400">
          Rotating your password revokes every active session (including this one).
        </p>
      </header>

      <GlassCard className="max-w-xl">
        {done ? (
          <div className="flex items-center gap-2 text-sm text-emerald-200">
            <CheckCircle2 className="h-4 w-4" />
            Password updated. Signing out…
          </div>
        ) : (
          <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              error={errors.current?.message}
              {...register('current', { required: 'Enter your current password' })}
            />
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              error={errors.next?.message}
              {...register('next', {
                required: 'Choose a new password',
                minLength: { value: 8, message: 'Use at least 8 characters' },
              })}
            />
            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              error={errors.confirm?.message}
              {...register('confirm', {
                validate: (v) => v === watch('next') || 'Passwords do not match',
              })}
            />
            {error && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </div>
            )}
            <Button type="submit" loading={submitting}>
              Update password
            </Button>
          </form>
        )}
      </GlassCard>
    </div>
  );
}
