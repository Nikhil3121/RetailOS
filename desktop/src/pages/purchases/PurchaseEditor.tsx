import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import {
  ArrowLeft,
  CheckCircle2,
  PackageCheck,
  Plus,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import { listProducts, getProduct, type Product } from '@/lib/catalog-api';
import {
  cancelPurchaseOrder,
  confirmPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  PO_STATUS_LABEL,
  receivePurchaseOrder,
  updatePurchaseOrder,
  type POLineCreate,
  type POStatus,
} from '@/lib/purchases-api';
import { listStores } from '@/lib/stores-api';
import { listSuppliers } from '@/lib/suppliers-api';

interface FormValues {
  supplier_id: string;
  store_id: string;
  order_date: string;
  expected_date: string;
  notes: string;
  lines: Array<POLineCreate & { display_name?: string }>;
}

const EMPTY_LINE = (): FormValues['lines'][number] => ({
  variant_id: '',
  quantity: '1',
  unit_cost: '0.00',
  tax_rate: '0.00',
  display_name: '',
});

export function PurchaseEditor(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transitionOpen, setTransitionOpen] = useState<'confirm' | 'receive' | 'cancel' | null>(null);

  const poQuery = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => getPurchaseOrder(id!),
    enabled: !isNew,
  });

  const suppliersQuery = useQuery({ queryKey: ['suppliers'], queryFn: () => listSuppliers(1, 500) });
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const productsQuery = useQuery({
    queryKey: ['products', 'all-for-po'],
    queryFn: () => listProducts({ page_size: 200, is_active: true }),
  });

  const form = useForm<FormValues>({
    defaultValues: {
      supplier_id: '',
      store_id: '',
      order_date: new Date().toISOString().slice(0, 10),
      expected_date: '',
      notes: '',
      lines: [EMPTY_LINE()],
    },
  });
  const { register, handleSubmit, control, reset, watch, setValue, formState: { errors } } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  useEffect(() => {
    if (!poQuery.data) return;
    const p = poQuery.data;
    reset({
      supplier_id: p.supplier_id,
      store_id: p.store_id,
      order_date: p.order_date,
      expected_date: p.expected_date ?? '',
      notes: p.notes ?? '',
      lines: p.lines.map((l) => ({
        variant_id: l.variant_id,
        quantity: l.quantity,
        unit_cost: l.unit_cost,
        tax_rate: l.tax_rate,
        display_name: '',
      })),
    });
  }, [poQuery.data, reset]);

  const status: POStatus = poQuery.data?.status ?? 'draft';
  const editable = isNew || status === 'draft';

  // Build a flat variant catalog for the selector dropdown.
  const variantOptions = useMemo(() => {
    const opts: { label: string; value: string; product: Product; unit_cost: string; tax_rate: string }[] = [];
    for (const summary of productsQuery.data?.items ?? []) {
      // We only have summary here (primary_sku + selling_price). A proper
      // multi-variant picker would need a dedicated /variants endpoint.
      if (!summary.primary_sku) continue;
      opts.push({
        label: `${summary.name} · ${summary.primary_sku}`,
        value: `variant:${summary.primary_sku}`, // placeholder; resolved on save
        product: summary as unknown as Product,
        unit_cost: '0.00',
        tax_rate: summary.tax_rate,
      });
    }
    return opts;
  }, [productsQuery.data]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const l of watch('lines')) {
      const qty = Number(l.quantity) || 0;
      const cost = Number(l.unit_cost) || 0;
      const rate = Number(l.tax_rate) || 0;
      const sub = qty * cost;
      subtotal += sub;
      tax += sub * (rate / 100);
    }
    return {
      subtotal: subtotal.toFixed(2),
      tax: tax.toFixed(2),
      total: (subtotal + tax).toFixed(2),
    };
  }, [watch('lines')]);

  async function resolveVariantIds(lines: FormValues['lines']): Promise<POLineCreate[]> {
    // Map any `variant:{SKU}` placeholders to real variant UUIDs by fetching
    // the full product. O(N) API calls — fine for small PO payloads.
    const out: POLineCreate[] = [];
    for (const line of lines) {
      let variantId = line.variant_id;
      if (variantId.startsWith('variant:')) {
        const sku = variantId.slice('variant:'.length);
        const summary = (productsQuery.data?.items ?? []).find((s) => s.primary_sku === sku);
        if (!summary) throw new Error(`Product with SKU ${sku} not found.`);
        const full = await getProduct(summary.id);
        const variant = full.variants.find((v) => v.sku === sku);
        if (!variant) throw new Error(`Variant ${sku} not found on ${summary.name}.`);
        variantId = variant.id;
      }
      out.push({
        variant_id: variantId,
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        tax_rate: line.tax_rate,
      });
    }
    return out;
  }

  async function onSubmit(values: FormValues): Promise<void> {
    setError(null);
    setSaving(true);
    try {
      const lines = await resolveVariantIds(values.lines);
      if (isNew) {
        const created = await createPurchaseOrder({
          supplier_id: values.supplier_id,
          store_id: values.store_id,
          order_date: values.order_date,
          expected_date: values.expected_date || null,
          notes: values.notes.trim() || null,
          lines,
        });
        qc.invalidateQueries({ queryKey: ['purchase-orders'] });
        navigate(`/purchases/${created.id}`, { replace: true });
      } else {
        await updatePurchaseOrder(id!, {
          supplier_id: values.supplier_id,
          expected_date: values.expected_date || null,
          notes: values.notes.trim() || null,
          lines,
        });
        qc.invalidateQueries({ queryKey: ['purchase-orders'] });
        qc.invalidateQueries({ queryKey: ['purchase-order', id] });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to save PO.');
    } finally {
      setSaving(false);
    }
  }

  async function runTransition(kind: 'confirm' | 'receive' | 'cancel'): Promise<void> {
    if (!id || isNew) return;
    setError(null);
    try {
      if (kind === 'confirm') await confirmPurchaseOrder(id);
      else if (kind === 'receive') await receivePurchaseOrder(id);
      else await cancelPurchaseOrder(id);
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['purchase-order', id] });
      qc.invalidateQueries({ queryKey: ['inventory-levels'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Transition failed.');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isNew ? 'New purchase order' : poQuery.data?.number ?? 'Purchase order'}
        description={
          isNew
            ? 'Create a draft PO. Confirm it once the supplier accepts, then receive to update stock.'
            : `Status: ${PO_STATUS_LABEL[status]} · ${poQuery.data?.order_date ?? ''}`
        }
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" leadingIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/purchases')}>
              Back
            </Button>
            {editable && (
              <Button loading={saving} leadingIcon={<Save className="h-4 w-4" />} onClick={handleSubmit(onSubmit)}>
                {isNew ? 'Create draft' : 'Save changes'}
              </Button>
            )}
            {!isNew && status === 'draft' && (
              <Button variant="secondary" leadingIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setTransitionOpen('confirm')}>
                Confirm
              </Button>
            )}
            {!isNew && status === 'confirmed' && (
              <Button leadingIcon={<PackageCheck className="h-4 w-4" />} onClick={() => setTransitionOpen('receive')}>
                Receive & post stock
              </Button>
            )}
            {!isNew && (status === 'draft' || status === 'confirmed') && (
              <Button variant="danger" leadingIcon={<XCircle className="h-4 w-4" />} onClick={() => setTransitionOpen('cancel')}>
                Cancel PO
              </Button>
            )}
          </div>
        }
      />

      {(error || poQuery.isError) && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error ?? (poQuery.error instanceof ApiError ? poQuery.error.message : 'Failed to load PO.')}
        </div>
      )}

      <GlassCard>
        <div className="grid grid-cols-3 gap-4">
          <Select
            label="Supplier"
            placeholder="— Select supplier —"
            options={(suppliersQuery.data?.items ?? []).map((s) => ({ label: s.name, value: s.id }))}
            error={errors.supplier_id?.message}
            disabled={!editable}
            {...register('supplier_id', { required: 'Supplier is required' })}
          />
          <Select
            label="Store"
            placeholder="— Select store —"
            options={(storesQuery.data?.items ?? []).map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))}
            error={errors.store_id?.message}
            disabled={!editable || !isNew}
            {...register('store_id', { required: 'Store is required' })}
          />
          <Input label="Order date" type="date" disabled={!editable || !isNew}
            {...register('order_date', { required: 'Order date is required' })} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <Input label="Expected delivery" type="date" disabled={!editable}
            {...register('expected_date')} />
        </div>
        <div className="mt-4">
          <Textarea label="Notes" rows={2} disabled={!editable} {...register('notes')} />
        </div>
      </GlassCard>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Lines</h2>
          {editable && (
            <Button size="sm" variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => append(EMPTY_LINE())}>
              Add line
            </Button>
          )}
        </div>
        <GlassCard className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-white/[0.02] text-left text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Product</th>
                {/* Quantities are entered in the product's PURCHASE unit and
                    converted to base units on receipt — 20 cartons of 12 lands
                    as 240 pieces. The conversion is configured per product in
                    the catalog, and applied once, server-side. */}
                <th className="px-4 py-3 text-right">
                  Qty
                  <span className="block text-xs font-normal normal-case text-slate-500">
                    in purchase units
                  </span>
                </th>
                <th className="px-4 py-3 text-right">Unit cost</th>
                <th className="px-4 py-3 text-right">GST %</th>
                <th className="px-4 py-3 text-right">Line total</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {fields.map((field, idx) => {
                const line = watch(`lines.${idx}`);
                const qty = Number(line?.quantity) || 0;
                const cost = Number(line?.unit_cost) || 0;
                const rate = Number(line?.tax_rate) || 0;
                const sub = qty * cost;
                const total = sub + sub * (rate / 100);
                return (
                  <tr key={field.id} className="border-b border-border/60 last:border-b-0">
                    <td className="px-3 py-2 align-top">
                      <Select
                        placeholder="— Select product —"
                        options={variantOptions.map((v) => ({ label: v.label, value: v.value }))}
                        disabled={!editable}
                        value={line?.variant_id ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setValue(`lines.${idx}.variant_id`, val);
                          // Prefill tax rate from selected product's default
                          const opt = variantOptions.find((v) => v.value === val);
                          if (opt) setValue(`lines.${idx}.tax_rate`, opt.tax_rate);
                        }}
                      />
                    </td>
                    <td className="w-28 px-3 py-2 align-top">
                      <Input type="number" step="0.001" min="0.001" disabled={!editable}
                        {...register(`lines.${idx}.quantity` as const, { required: true })} />
                    </td>
                    <td className="w-32 px-3 py-2 align-top">
                      <Input type="number" step="0.01" min="0" disabled={!editable}
                        {...register(`lines.${idx}.unit_cost` as const, { required: true })} />
                    </td>
                    <td className="w-24 px-3 py-2 align-top">
                      <Input type="number" step="0.01" min="0" max="100" disabled={!editable}
                        {...register(`lines.${idx}.tax_rate` as const)} />
                    </td>
                    <td className="w-32 px-4 py-3 text-right font-mono text-slate-100 align-top">
                      ₹{total.toFixed(2)}
                    </td>
                    <td className="w-16 px-3 py-2 text-right align-top">
                      {editable && fields.length > 1 && (
                        <Button size="sm" variant="ghost" onClick={() => remove(idx)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-border-strong">
              <tr>
                <td className="px-4 py-3 text-right text-slate-400" colSpan={4}>Subtotal</td>
                <td className="px-4 py-3 text-right font-mono text-slate-100">₹{totals.subtotal}</td>
                <td />
              </tr>
              <tr>
                <td className="px-4 py-2 text-right text-slate-400" colSpan={4}>GST</td>
                <td className="px-4 py-2 text-right font-mono text-slate-100">₹{totals.tax}</td>
                <td />
              </tr>
              <tr>
                <td className="px-4 py-3 text-right text-sm font-semibold text-white" colSpan={4}>Grand total</td>
                <td className="px-4 py-3 text-right font-mono text-lg font-semibold text-white">₹{totals.total}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </GlassCard>
      </div>

      <ConfirmDialog
        open={transitionOpen === 'confirm'}
        onClose={() => setTransitionOpen(null)}
        title="Confirm purchase order"
        description="Once confirmed, lines are frozen. You can then receive stock or cancel — but not edit."
        confirmLabel="Confirm PO"
        onConfirm={() => runTransition('confirm')}
      />
      <ConfirmDialog
        open={transitionOpen === 'receive'}
        onClose={() => setTransitionOpen(null)}
        title="Receive stock"
        description="Posts stock movements to the ledger for every line and locks the PO as received."
        confirmLabel="Receive & post"
        onConfirm={() => runTransition('receive')}
      />
      <ConfirmDialog
        open={transitionOpen === 'cancel'}
        onClose={() => setTransitionOpen(null)}
        title="Cancel purchase order"
        description="Cancellation is permanent. No stock movements are posted."
        destructive
        confirmLabel="Cancel PO"
        onConfirm={() => runTransition('cancel')}
      />
    </div>
  );
}
