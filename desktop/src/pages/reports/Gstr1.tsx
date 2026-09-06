/**
 * GSTR-1 — the monthly outward-supplies return, as a working paper.
 *
 * WHAT THIS SCREEN IS HONEST ABOUT
 * It is not a portal upload. The GSTN JSON schema is versioned and rejects on
 * details that only surface on submission, and this system has never touched
 * the portal. What it removes is the month of hand-adding: every section the
 * return has, with the figures already tied together.
 *
 * The warnings banner is not decoration and is not dismissible. A line with no
 * HSN code is a line missing from a mandatory section; a malformed GSTIN is a
 * row the portal will reject. Whoever files this needs to see both before they
 * file, not after.
 *
 * Each section downloads as CSV, because the person doing the filing works in
 * a spreadsheet and pasting from a web table loses the leading zeros on a
 * state code and an HSN.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, FileSpreadsheet } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { StatTile } from '@/components/ui/StatTile';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { gstr1, type Gstr1Return } from '@/lib/reports-api';
import { listStores } from '@/lib/stores-api';

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** First and last day of the month just gone — the period actually filed. */
function lastMonth(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: iso(first), to: iso(last) };
}

/**
 * Quote every field.
 *
 * A GSTIN is safe unquoted, but a customer name with a comma in it is not, and
 * a state code like "09" loses its leading zero the moment a spreadsheet
 * decides it is a number. Quoting everything costs nothing and removes a class
 * of silent corruption from a document that goes to a tax office.
 */
function csvCell(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function downloadCsv(name: string, header: string[], rows: unknown[][]): void {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  // A BOM, so Excel opens it as UTF-8 rather than mangling ₹ and any
  // non-ASCII customer name.
  const blob = new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function Gstr1(): JSX.Element {
  const period = lastMonth();
  const [storeId, setStoreId] = useState('');
  const [fromDate, setFromDate] = useState(period.from);
  const [toDate, setToDate] = useState(period.to);

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const stores = storesQuery.data?.items ?? [];

  const query = useQuery({
    queryKey: ['gstr1', storeId, fromDate, toDate],
    queryFn: () => gstr1({ store_id: storeId, from_date: fromDate, to_date: toDate }),
    enabled: Boolean(storeId),
  });
  const r: Gstr1Return | undefined = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="GSTR-1"
        description="Outward supplies, laid out the way the return is."
      />

      {/* Said once, plainly, at the top. A screen that produces GST figures
          and does not say what it is will be taken for something it is not. */}
      <div className="rounded-xl border border-border bg-white/[0.02] px-4 py-3 text-xs text-slate-400">
        This is a <strong className="text-slate-200">working paper</strong>, not a
        portal upload. It does the arithmetic so the figures can be checked
        against the books; the return itself is still filed on the GST portal by
        your accountant.
      </div>

      <GlassCard className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[240px] flex-1">
          <Select
            label="Branch"
            placeholder="— Choose a branch —"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            options={stores.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))}
            hint="A return is filed against one GSTIN. The two malls file separately."
          />
        </div>
        <div className="min-w-[160px]">
          <Input label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="min-w-[160px]">
          <Input label="To" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </GlassCard>

      {!storeId && (
        <p className="text-sm text-slate-500">Choose a branch to prepare its return.</p>
      )}

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError
            ? query.error.message
            : 'Could not prepare the return.'}
        </div>
      )}

      {r && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm text-slate-300">
              {r.store_name}
              <span className="ml-2 font-mono text-xs text-slate-500">{r.gstin}</span>
            </div>
            <div className="text-xs text-slate-500">
              {r.from_date} to {r.to_date}
            </div>
          </div>

          {/* Not dismissible, and above the totals. Anything below this banner
              is incomplete in a way the person filing must know about. */}
          {r.warnings.length > 0 && (
            <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                Fix these before filing
              </div>
              <ul className="list-inside list-disc space-y-1 text-xs text-amber-200/90">
                {r.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Taxable value" value={formatMoney(r.total_taxable_value)} />
            <StatTile label="Tax" value={formatMoney(r.total_tax)} />
            <StatTile label="Invoice value" value={formatMoney(r.total_invoice_value)} />
          </div>

          <Section
            title="B2B — registered customers"
            note="Reported invoice by invoice, because the recipient claims credit against each one."
            count={r.b2b.length}
            onExport={() =>
              downloadCsv(
                `gstr1-b2b-${r.from_date}.csv`,
                ['GSTIN', 'Customer', 'Invoice no.', 'Date', 'Value',
                 'Place of supply', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST'],
                r.b2b.flatMap((i) =>
                  i.lines.map((l) => [
                    i.customer_gstin, i.customer_name, i.invoice_number,
                    i.invoice_date, i.invoice_value, i.place_of_supply,
                    l.rate, l.taxable_value, l.cgst, l.sgst, l.igst,
                  ]),
                ),
              )
            }
          >
            <Table
              head={['Invoice', 'Customer', 'GSTIN', 'POS', 'Taxable', 'Tax', 'Value']}
              rows={r.b2b.map((i) => [
                i.invoice_number,
                i.customer_name,
                <span key="g" className="font-mono text-xs">{i.customer_gstin}</span>,
                i.place_of_supply,
                formatMoney(
                  String(i.lines.reduce((s, l) => s + Number(l.taxable_value), 0)),
                ),
                formatMoney(
                  String(
                    i.lines.reduce(
                      (s, l) => s + Number(l.cgst) + Number(l.sgst) + Number(l.igst),
                      0,
                    ),
                  ),
                ),
                formatMoney(i.invoice_value),
              ])}
            />
          </Section>

          <Section
            title="B2C — counter sales"
            note="Summarised by place of supply and rate. There is nobody to claim credit, so no invoice list."
            count={r.b2cs.length}
            onExport={() =>
              downloadCsv(
                `gstr1-b2cs-${r.from_date}.csv`,
                ['Place of supply', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST', 'Bills'],
                r.b2cs.map((x) => [
                  x.place_of_supply, x.rate, x.taxable_value,
                  x.cgst, x.sgst, x.igst, x.invoice_count,
                ]),
              )
            }
          >
            <Table
              head={['POS', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST', 'Bills']}
              rows={r.b2cs.map((x) => [
                x.place_of_supply,
                `${Number(x.rate)}%`,
                formatMoney(x.taxable_value),
                formatMoney(x.cgst),
                formatMoney(x.sgst),
                formatMoney(x.igst),
                x.invoice_count,
              ])}
            />
          </Section>

          <Section
            title="Credit notes"
            note="Shown POSITIVE, as the return expects. This system stores returns as negative money so revenue nets out; the return does the opposite."
            count={r.credit_notes.length}
            onExport={() =>
              downloadCsv(
                `gstr1-cdn-${r.from_date}.csv`,
                ['Note no.', 'Date', 'Against invoice', 'GSTIN', 'Customer',
                 'Place of supply', 'Value', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST'],
                r.credit_notes.flatMap((n) =>
                  n.lines.map((l) => [
                    n.note_number, n.note_date, n.original_invoice_number ?? '',
                    n.customer_gstin ?? '', n.customer_name ?? '',
                    n.place_of_supply, n.note_value,
                    l.rate, l.taxable_value, l.cgst, l.sgst, l.igst,
                  ]),
                ),
              )
            }
          >
            <Table
              head={['Note', 'Against', 'Customer', 'POS', 'Value']}
              rows={r.credit_notes.map((n) => [
                n.note_number,
                n.original_invoice_number ?? '—',
                n.customer_name ?? 'Walk-in',
                n.place_of_supply,
                formatMoney(n.note_value),
              ])}
            />
          </Section>

          <Section
            title="HSN summary"
            note="Mandatory, and the section most often left blank."
            count={r.hsn.length}
            onExport={() =>
              downloadCsv(
                `gstr1-hsn-${r.from_date}.csv`,
                ['HSN', 'Description', 'UQC', 'Quantity', 'Taxable',
                 'CGST', 'SGST', 'IGST'],
                r.hsn.map((x) => [
                  x.hsn_code, x.description, x.uqc, x.quantity,
                  x.taxable_value, x.cgst, x.sgst, x.igst,
                ]),
              )
            }
          >
            <Table
              head={['HSN', 'Description', 'Qty', 'Taxable', 'CGST', 'SGST', 'IGST']}
              rows={r.hsn.map((x) => [
                <span key="h" className="font-mono text-xs">{x.hsn_code}</span>,
                x.description,
                Number(x.quantity),
                formatMoney(x.taxable_value),
                formatMoney(x.cgst),
                formatMoney(x.sgst),
                formatMoney(x.igst),
              ])}
            />
          </Section>

          <Section
            title="Documents issued"
            note="A gap in an invoice series is the first thing an officer looks for."
            count={r.documents.length}
          >
            <Table
              head={['Type', 'From', 'To', 'Count', 'Cancelled']}
              rows={r.documents.map((d) => [
                d.document_type,
                d.from_number,
                d.to_number,
                d.total_count,
                d.cancelled_count,
              ])}
            />
          </Section>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  note,
  count,
  onExport,
  children,
}: {
  title: string;
  note: string;
  count: number;
  onExport?: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <GlassCard className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <FileSpreadsheet className="h-4 w-4" />
            {title}
            <span className="font-normal text-slate-500">({count})</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{note}</p>
        </div>
        {onExport && count > 0 && (
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Download className="h-3.5 w-3.5" />}
            onClick={onExport}
          >
            CSV
          </Button>
        )}
      </div>
      {count === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">
          Nothing in this section for the period.
        </p>
      ) : (
        children
      )}
    </GlassCard>
  );
}

function Table({
  head,
  rows,
}: {
  head: string[];
  rows: React.ReactNode[][];
}): JSX.Element {
  return (
    // Its own scroll container — a GST table is wide, and the page body must
    // never scroll sideways.
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-300"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
