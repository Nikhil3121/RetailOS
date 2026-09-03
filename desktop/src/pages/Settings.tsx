import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import {
  twoFactorDisable,
  twoFactorSetup,
  twoFactorStatus,
  twoFactorVerify,
  type TwoFactorSetupResponse,
} from '@/lib/auth-api';

const KEYS = {
  currency: 'retailos.settings.currency',
  invoiceFooter: 'retailos.settings.invoiceFooter',
  registerName: 'retailos.settings.registerName',
} as const;

/** Per-workstation preferences kept in localStorage + account-level security. */
export function Settings(): JSX.Element {
  const [currency, setCurrency] = useState<string>('INR');
  const [footer, setFooter] = useState<string>('Thank you for shopping with us.');
  const [registerName, setRegisterName] = useState<string>('Counter 1');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setCurrency(localStorage.getItem(KEYS.currency) ?? 'INR');
    setFooter(localStorage.getItem(KEYS.invoiceFooter) ?? 'Thank you for shopping with us.');
    setRegisterName(localStorage.getItem(KEYS.registerName) ?? 'Counter 1');
  }, []);

  function save(): void {
    localStorage.setItem(KEYS.currency, currency.trim() || 'INR');
    localStorage.setItem(KEYS.invoiceFooter, footer);
    localStorage.setItem(KEYS.registerName, registerName.trim() || 'Counter 1');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Per-workstation preferences and account-level security."
      />

      <GlassCard className="max-w-2xl">
        <div className="space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Workstation preferences
          </div>
          <Input
            label="Currency symbol"
            hint="Displayed on receipts and reports (default INR / ₹)."
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            maxLength={8}
          />
          <Input
            label="Register / counter name"
            value={registerName}
            onChange={(e) => setRegisterName(e.target.value)}
            maxLength={64}
          />
          <Textarea
            label="Invoice footer"
            rows={3}
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
          />

          <div className="flex items-center justify-between pt-2">
            {saved ? (
              <span className="flex items-center gap-2 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Saved
              </span>
            ) : (
              <span />
            )}
            <Button onClick={save}>Save preferences</Button>
          </div>
        </div>
      </GlassCard>

      <TwoFactorPanel />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Two-factor authentication panel
// ---------------------------------------------------------------------------

function TwoFactorPanel(): JSX.Element {
  const qc = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ['2fa-status'],
    queryFn: twoFactorStatus,
  });
  const [openSetup, setOpenSetup] = useState(false);
  const [openDisable, setOpenDisable] = useState(false);
  const enabled = Boolean(statusQuery.data?.enabled);

  return (
    <GlassCard className="max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span
            className={
              enabled
                ? 'flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-white/[0.03] text-slate-400'
            }
          >
            {enabled ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
          </span>
          <div>
            <div className="text-sm font-semibold uppercase tracking-wider text-white">
              Two-factor authentication
            </div>
            <p className="mt-1 max-w-md text-xs text-slate-400">
              An extra 6-digit code from an authenticator app (Google Authenticator,
              Authy, 1Password…) is required at every login. Strongly recommended
              for owner and super-admin accounts.
            </p>
            <div className="mt-2 text-xs">
              Status:{' '}
              <span
                className={
                  enabled ? 'font-semibold text-emerald-300' : 'font-semibold text-amber-300'
                }
              >
                {enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>
        </div>
        <div>
          {enabled ? (
            <Button
              variant="secondary"
              leadingIcon={<ShieldOff className="h-4 w-4" />}
              onClick={() => setOpenDisable(true)}
            >
              Disable
            </Button>
          ) : (
            <Button
              leadingIcon={<ShieldCheck className="h-4 w-4" />}
              onClick={() => setOpenSetup(true)}
            >
              Enable
            </Button>
          )}
        </div>
      </div>

      <TwoFactorSetupModal
        open={openSetup}
        onClose={() => setOpenSetup(false)}
        onEnabled={() => {
          setOpenSetup(false);
          qc.invalidateQueries({ queryKey: ['2fa-status'] });
        }}
      />
      <TwoFactorDisableModal
        open={openDisable}
        onClose={() => setOpenDisable(false)}
        onDisabled={() => {
          setOpenDisable(false);
          qc.invalidateQueries({ queryKey: ['2fa-status'] });
        }}
      />
    </GlassCard>
  );
}

function TwoFactorSetupModal({
  open,
  onClose,
  onEnabled,
}: {
  open: boolean;
  onClose: () => void;
  onEnabled: () => void;
}): JSX.Element {
  const [setup, setSetup] = useState<TwoFactorSetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCode('');
    setSetup(null);
    // Kick off enrolment on open — the server issues a fresh secret each time
    // the user starts the flow, so nothing leaks between attempts.
    void twoFactorSetup()
      .then(setSetup)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not start 2FA setup.'),
      );
  }, [open]);

  const verify = useMutation({
    mutationFn: () => twoFactorVerify(code.trim()),
    onSuccess: onEnabled,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Verification failed.'),
  });

  const copySecret = (): void => {
    if (setup?.secret) void navigator.clipboard.writeText(setup.secret).catch(() => {});
  };

  return (
    <Modal open={open} onClose={onClose} title="Enable two-factor authentication" size="lg">
      <div className="space-y-4">
        <ol className="ml-5 list-decimal space-y-1 text-sm text-slate-300">
          <li>Open your authenticator app (Google Authenticator / Authy / 1Password).</li>
          <li>
            Add a new account using the setup key below (or scan the URI as a QR
            with your phone's camera).
          </li>
          <li>Enter the 6-digit code the app shows to finish enabling.</li>
        </ol>

        <div className="rounded-xl border border-border bg-white/[0.02] p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Setup key
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <code className="break-all font-mono text-base text-white">
              {setup?.secret ?? 'Loading…'}
            </code>
            {setup?.secret && (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={<Copy className="h-3.5 w-3.5" />}
                onClick={copySecret}
              >
                Copy
              </Button>
            )}
          </div>
          {setup?.provisioning_uri && (
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                otpauth:// URI (QR-scan friendly)
              </div>
              <code className="mt-1 block break-all font-mono text-xs text-slate-400">
                {setup.provisioning_uri}
              </code>
            </div>
          )}
        </div>

        <Input
          label="6-digit code from your app"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123 456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={!setup}
        />

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={verify.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => verify.mutate()}
            disabled={!setup || code.trim().length < 6 || verify.isPending}
            loading={verify.isPending}
            leadingIcon={<ShieldCheck className="h-4 w-4" />}
          >
            Verify & enable
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TwoFactorDisableModal({
  open,
  onClose,
  onDisabled,
}: {
  open: boolean;
  onClose: () => void;
  onDisabled: () => void;
}): JSX.Element {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPassword('');
    setCode('');
  }, [open]);

  const disable = useMutation({
    mutationFn: () => twoFactorDisable(password, code.trim()),
    onSuccess: onDisabled,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Disable failed.'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Disable two-factor authentication">
      <div className="space-y-4">
        <p className="text-sm text-amber-200">
          Requires your current password AND a valid authenticator code — so a
          stolen browser session alone can't quietly turn 2FA off.
        </p>
        <Input
          label="Current password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123 456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={disable.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => disable.mutate()}
            disabled={!password || code.trim().length < 6 || disable.isPending}
            loading={disable.isPending}
          >
            Disable
          </Button>
        </div>
      </div>
    </Modal>
  );
}
