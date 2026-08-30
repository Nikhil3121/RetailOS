/**
 * Hardware diagnostics.
 *
 * Written for the person standing at the counter with a new scanner and
 * printer in a box, not for a developer. Its job is to answer three questions
 * without anyone opening a terminal:
 *
 *   Is the scanner sending what I think it is?
 *   Will the printer print, and at the right width?
 *   If not, what exactly is missing?
 *
 * It is also deliberately honest about the gap: nothing here has been verified
 * against physical hardware, and the screen says so rather than showing a
 * green tick that means "the software is fine".
 */

import { useEffect, useRef, useState } from 'react';
import { Printer, ScanBarcode, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import {
  configurePrinter,
  getPrinterStatus,
  printTestPage,
  type PaperWidth,
  type PrinterStatus,
  type PrintResult,
} from '@/lib/print-service';
import { simulateScan } from '@/lib/scanner/scanner-simulator';
import {
  WedgeDetector,
  looksLikeBarcode,
  type ScanCandidate,
} from '@/lib/scanner/wedge-detector';

export function HardwareDiagnostics(): JSX.Element {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Hardware"
        description="Check the barcode scanner and receipt printer on this terminal."
      />
      <NotVerifiedNotice />
      <ScannerTest />
      <PrinterTest />
    </div>
  );
}

function NotVerifiedNotice(): JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-medium">Not yet tested with real hardware.</div>
        <p className="mt-0.5 text-xs text-amber-200/80">
          The scanner and printer software is built and tested, but no physical
          scanner or thermal printer has been connected yet. Use this screen to
          check them when the hardware arrives.
        </p>
      </div>
    </div>
  );
}

/**
 * Live scanner check.
 *
 * Reads raw keystrokes and reports what a scanner actually sent — the string,
 * how fast it arrived, and whether that speed looks like a device or a person.
 * That is what distinguishes "the scanner is not working" from "the scanner is
 * working and the barcode is not in the catalog", which look identical from
 * behind the counter.
 */
function ScannerTest(): JSX.Element {
  const [lastScan, setLastScan] = useState<ScanCandidate | null>(null);
  const [lastTyped, setLastTyped] = useState<ScanCandidate | null>(null);
  const [pending, setPending] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const detectorRef = useRef<WedgeDetector | null>(null);

  if (!detectorRef.current) {
    detectorRef.current = new WedgeDetector({
      onScan: (candidate) => {
        setLastScan(candidate);
        setPending('');
      },
      onHuman: (candidate) => {
        setLastTyped(candidate);
        setPending('');
      },
    });
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <GlassCard className="space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold text-white">
        <ScanBarcode className="h-5 w-5 text-cobalt-300" />
        Scanner
      </div>
      <p className="text-xs text-slate-400">
        Click the box and scan any barcode. Nothing is added to a bill — this
        only reports what the scanner sent.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <Input
            ref={inputRef}
            label="Scan here"
            placeholder="Scan a barcode…"
            value={pending}
            onChange={() => {
              /* the detector owns the value; keystrokes drive it */
            }}
            onKeyDown={(e) => {
              detectorRef.current?.push({ key: e.key, timeStamp: e.timeStamp });
              setPending(detectorRef.current?.pending() ?? '');
              if (e.key === 'Enter') e.preventDefault();
            }}
          />
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            // Proves the whole path without hardware: real keyboard events at
            // scanner speed, through the same listener a device would use.
            inputRef.current?.focus();
            void simulateScan('8901234567890', { target: inputRef.current });
          }}
        >
          Simulate a scan
        </Button>
      </div>

      {lastScan && (
        <Result
          tone="good"
          title="Scanner detected"
          rows={[
            ['Code', lastScan.value],
            ['Characters', String(lastScan.value.length)],
            ['Time taken', `${Math.round(lastScan.durationMs)} ms`],
            ['Slowest gap', `${Math.round(lastScan.maxGapMs)} ms`],
            ['Valid format', looksLikeBarcode(lastScan.value) ? 'Yes' : 'No — unusual characters'],
          ]}
        />
      )}

      {lastTyped && (
        <Result
          tone="info"
          title="Read as typing, not a scan"
          rows={[
            ['Text', lastTyped.value],
            ['Slowest gap', `${Math.round(lastTyped.maxGapMs)} ms`],
            ['Why', 'Too slow or too short for a scanner. This is expected when you type by hand.'],
          ]}
        />
      )}
    </GlassCard>
  );
}

function PrinterTest(): JSX.Element {
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [result, setResult] = useState<PrintResult | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => setStatus(await getPrinterStatus());
  useEffect(() => {
    void refresh();
  }, []);

  if (!status) {
    return (
      <GlassCard>
        <div className="flex items-center gap-2 text-lg font-semibold text-white">
          <Printer className="h-5 w-5 text-slate-400" />
          Printer
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Thermal printing is only available in the desktop app. Receipts print
          through the browser dialog here.
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-lg font-semibold text-white">
          <Printer className="h-5 w-5 text-cobalt-300" />
          Printer
        </div>
        <span
          className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
            status.ready
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-slate-500/30 bg-slate-500/10 text-slate-300'
          }`}
        >
          {status.ready ? 'Ready' : 'Not configured'}
        </span>
      </div>

      <p className="text-xs text-slate-400">{status.message}</p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[160px]">
          <Select
            label="Paper width"
            options={[
              { label: '80mm (48 columns)', value: '80mm' },
              { label: '58mm (32 columns)', value: '58mm' },
            ]}
            value={status.width}
            onChange={async (e) => {
              setStatus(await configurePrinter({ width: e.target.value as PaperWidth }));
            }}
          />
        </div>
        <div className="min-w-[200px]">
          <Select
            label="Output"
            options={[
              { label: 'None — use browser dialog', value: 'none' },
              { label: 'Virtual printer (writes a file)', value: 'virtual' },
            ]}
            value={status.driver}
            onChange={async (e) => {
              setStatus(
                await configurePrinter({ driver: e.target.value as 'none' | 'virtual' }),
              );
            }}
          />
        </div>
        <Button
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setResult(await printTestPage());
            await refresh();
            setBusy(false);
          }}
        >
          Print test receipt
        </Button>
      </div>

      {result && (
        <Result
          tone={result.ok ? 'good' : 'bad'}
          title={result.ok ? 'Test receipt sent' : 'Test receipt failed'}
          rows={[
            ['Output', result.driver],
            ['Attempts', String(result.attempts)],
            ...(result.bytes ? ([['Size', `${result.bytes} bytes`]] as [string, string][]) : []),
            ...(result.file ? ([['Written to', result.file]] as [string, string][]) : []),
            ...(result.error ? ([['Problem', result.error]] as [string, string][]) : []),
            ...(result.fallbackToBrowser
              ? ([['Fallback', 'Receipts will print through the browser dialog.']] as [string, string][])
              : []),
          ]}
        />
      )}

      {status.missingDriver && status.missingDriver.length > 0 && (
        <div className="rounded-xl border border-border bg-white/[0.02] p-3">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Before a real printer will work
          </div>
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            {status.missingDriver.map((note) => (
              <li key={note}>· {note}</li>
            ))}
          </ul>
        </div>
      )}
    </GlassCard>
  );
}

function Result({
  tone, title, rows,
}: {
  tone: 'good' | 'bad' | 'info';
  title: string;
  rows: [string, string][];
}): JSX.Element {
  const border =
    tone === 'good'
      ? 'border-emerald-500/30 bg-emerald-500/10'
      : tone === 'bad'
        ? 'border-rose-500/30 bg-rose-500/10'
        : 'border-border bg-white/[0.02]';

  return (
    <div className={`rounded-xl border p-3 ${border}`}>
      <div className="text-sm font-medium text-white">{title}</div>
      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] uppercase tracking-wider text-slate-500">{label}</dt>
            <dd className="break-all font-mono text-xs text-slate-300">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
