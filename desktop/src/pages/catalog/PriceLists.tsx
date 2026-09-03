/**
 * Price lists — the rate cards a wholesaler actually bills on.
 *
 * Two panes, because they answer different questions. The left asks "which rate
 * cards exist"; the right asks "what does this card charge for that item". A
 * single table cannot do both without becoming a spreadsheet.
 *
 * A list is deliberately SPARSE: it holds only the rates that differ from the
 * shelf price. Anything not on it falls back to the variant's own
 * selling_price, so a new card is useful the moment it has one rate on it. The
 * screen states that rather than leaving it to be discovered.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Search, Star, Tag, Trash2, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { ApiError } from '@/lib/api';
import { getProduct, listProducts } from '@/lib/catalog-api';
import {
  createPriceList,
  listPriceListItems,
  listPriceLists,
  removePriceListItem,
  setPriceListItems,
  updatePriceList,
  type PriceList,
} from '@/lib/price-lists-api';
import { cn } from '@/lib/cn';

export function PriceLists(): JSX.Element {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listsQuery = useQuery({
    queryKey: ['price-lists'],
    queryFn: () => listPriceLists(true),
  });
  const lists = listsQuery.data ?? [];

  // Land on something rather than an empty right pane.
  useEffect(() => {
    if (!selected && lists.length > 0) setSelected(lists[0].id);
  }, [lists, selected]);

  const active = lists.find((l) => l.id === selected) ?? null;

  const setDefault = useMutation({
    mutationFn: (l: PriceList) => updatePriceList(l.id, { is_default: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-lists'] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not set the default.'),
  });

  const toggleActive = useMutation({
    mutationFn: (l: PriceList) => updatePriceList(l.id, { is_active: !l.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-lists'] }),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Price lists"
        description="Wholesale, retail and dealer rates. A customer on a list is billed at its rate automatically."
        actions={
          <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New price list
          </Button>
        }
      />

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/*
        A FAILED LOAD IS NOT AN EMPTY LIST.

        Without this, a 404 renders as "No price lists yet." — indistinguishable
        from a shop that simply has not made one. That mistake hid a missing
        deployment twice; it is the empty state that must be earned, not the
        error.
      */}
      {listsQuery.isError && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <b className="font-semibold">Could not load price lists.</b>{' '}
            {listsQuery.error instanceof ApiError
              ? listsQuery.error.message
              : 'The server did not respond as expected.'}
            {listsQuery.error instanceof ApiError &&
              listsQuery.error.status === 404 && (
                <> This server does not support price lists yet — the feature is
                built but has not been deployed to it.</>
              )}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <GlassCard className="min-w-0 p-0">
          <div className="border-b border-border px-4 py-3 text-xs font-medium text-slate-400">
            Rate cards
          </div>
          {lists.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              {listsQuery.isLoading
                ? 'Loading…'
                : listsQuery.isError
                  ? 'Could not load.'
                  : 'No price lists yet.'}
            </div>
          ) : (
            <ul className="p-2">
              {lists.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(l.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
                      selected === l.id
                        ? 'bg-brand-600 text-onbrand'
                        : 'text-slate-300 hover:bg-surface-muted',
                      !l.is_active && 'opacity-50',
                    )}
                  >
                    <Tag className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{l.name}</span>
                      <span className="block truncate font-mono text-xs opacity-70">
                        {l.code}
                        {!l.is_active && ' · archived'}
                      </span>
                    </span>
                    {l.is_default && (
                      <Star className="h-3.5 w-3.5 shrink-0" aria-label="Default" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        {active ? (
          <div className="min-w-0 space-y-4">
            <GlassCard className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-white">{active.name}</div>
                <div className="text-xs text-slate-500">
                  {active.is_default
                    ? 'Default — used for any customer without a list of their own.'
                    : 'Applies only to customers assigned to it.'}
                </div>
              </div>
              {!active.is_default && (
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Star className="h-3.5 w-3.5" />}
                  loading={setDefault.isPending}
                  onClick={() => setDefault.mutate(active)}
                >
                  Make default
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                loading={toggleActive.isPending}
                onClick={() => toggleActive.mutate(active)}
              >
                {active.is_active ? 'Archive' : 'Restore'}
              </Button>
            </GlassCard>

            <RatesPanel list={active} onError={setError} />
          </div>
        ) : (
          <GlassCard className="min-w-0 px-4 py-14 text-center text-sm text-slate-500">
            Create a price list to set wholesale or dealer rates.
          </GlassCard>
        )}
      </div>

      <CreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(l) => {
          setSelected(l.id);
          void qc.invalidateQueries({ queryKey: ['price-lists'] });
        }}
        onError={setError}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function RatesPanel({
  list, onError,
}: {
  list: PriceList;
  onError: (m: string) => void;
}): JSX.Element {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});

  const itemsQuery = useQuery({
    queryKey: ['price-list-items', list.id],
    queryFn: () => listPriceListItems(list.id),
  });
  // The catalog is large; only fetch when someone is actually looking.
  const productsQuery = useQuery({
    queryKey: ['price-list-search', search],
    queryFn: () => listProducts({ search, page_size: 15 }),
    enabled: search.trim().length > 1,
  });

  // A product summary carries no variants, and rates are set PER VARIANT —
  // navy/L and navy/M can legitimately differ. So picking a product loads it.
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  const productQuery = useQuery({
    queryKey: ['price-list-product', openProduct],
    queryFn: () => getProduct(openProduct!),
    enabled: !!openProduct,
  });

  const rates = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of itemsQuery.data ?? []) map.set(i.variant_id, i.price);
    return map;
  }, [itemsQuery.data]);

  const save = useMutation({
    mutationFn: (items: { variant_id: string; price: string }[]) =>
      setPriceListItems(list.id, items),
    onSuccess: () => {
      setDraft({});
      void qc.invalidateQueries({ queryKey: ['price-list-items', list.id] });
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : 'Could not save rates.'),
  });

  const drop = useMutation({
    mutationFn: (variantId: string) => removePriceListItem(list.id, variantId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-list-items', list.id] }),
  });

  const pending = Object.entries(draft).filter(([, v]) => v.trim() !== '');

  // Variants of the opened product, with their shelf price alongside so the
  // rate being typed can be judged against what it replaces.
  const found = (productQuery.data?.variants ?? []).map((v) => ({
    variant_id: v.id,
    label: `${productQuery.data?.name ?? ''} · ${v.name}`,
    sku: v.sku,
    shelf: v.selling_price,
  }));

  return (
    <GlassCard className="min-w-0 p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-border-strong bg-surface-muted px-3">
          <Search className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a product to price…"
            className="h-9 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </div>
        {pending.length > 0 && (
          <Button
            size="sm"
            loading={save.isPending}
            leadingIcon={<Check className="h-3.5 w-3.5" />}
            onClick={() =>
              save.mutate(
                pending.map(([variant_id, price]) => ({
                  variant_id,
                  price: Number(price).toFixed(2),
                })),
              )
            }
          >
            Save {pending.length} rate{pending.length === 1 ? '' : 's'}
          </Button>
        )}
      </div>

      {/* Pick a product, then price its variants. Rates are per variant —
          navy/L and navy/M can legitimately cost different amounts. */}
      {search.trim().length > 1 && !openProduct && (
        <div className="max-h-64 overflow-y-auto border-b border-border">
          {(productsQuery.data?.items ?? []).length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">
              {productsQuery.isLoading ? 'Searching…' : 'Nothing matches that.'}
            </div>
          ) : (
            (productsQuery.data?.items ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOpenProduct(p.id)}
                className="flex w-full items-center justify-between gap-3 border-b border-border/50 px-4 py-2 text-left last:border-b-0 hover:bg-surface-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-slate-100">{p.name}</span>
                  <span className="block truncate font-mono text-xs text-slate-500">
                    {p.primary_sku ?? '—'} · {p.variant_count} variant
                    {p.variant_count === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="money shrink-0 text-xs text-slate-500">
                  shelf ₹{Number(p.primary_selling_price ?? 0).toFixed(2)}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {openProduct && (
        <div className="border-b border-border">
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <span className="text-xs font-medium text-slate-400">
              {productQuery.data?.name ?? 'Loading…'} — set a rate per variant
            </span>
            <Button size="sm" variant="ghost" onClick={() => setOpenProduct(null)}>
              Back to results
            </Button>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {found.map((f) => (
                <tr key={f.variant_id} className="border-t border-border/50">
                  <td className="px-4 py-2">
                    <div className="text-slate-100">{f.label}</div>
                    <div className="font-mono text-xs text-slate-500">{f.sku}</div>
                  </td>
                  <td className="money px-3 py-2 text-right text-xs text-slate-500">
                    shelf ₹{Number(f.shelf).toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder={rates.get(f.variant_id) ?? 'no rate'}
                      value={draft[f.variant_id] ?? ''}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, [f.variant_id]: e.target.value }))
                      }
                      className="money w-28 rounded-lg border border-border-strong bg-surface-muted px-2 py-1 text-right text-sm text-slate-100 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-4 py-3 text-xs font-medium text-slate-400">
        Rates on this list ({rates.size})
      </div>

      {rates.size === 0 ? (
        <div className="px-4 pb-10 text-center text-sm text-slate-500">
          No rates yet. Anything not listed here is billed at its own shelf price —
          so this card is usable as soon as it has one rate on it.
        </div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {(itemsQuery.data ?? []).map((i) => (
              <tr key={i.id} className="border-t border-border/50">
                <td className="px-4 py-2">
                  <div className="text-slate-100">
                    {i.product_name ?? 'Unknown item'}
                    {i.variant_name ? ` · ${i.variant_name}` : ''}
                  </div>
                  <div className="font-mono text-xs text-slate-500">{i.sku ?? '—'}</div>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="money font-medium text-white">
                    ₹{Number(i.price).toFixed(2)}
                  </div>
                  {/* What this rate replaces, so the discount is legible. */}
                  {i.base_price && (
                    <div className="money text-xs text-slate-500 line-through">
                      ₹{Number(i.base_price).toFixed(2)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => drop.mutate(i.variant_id)}
                    title="Remove — this variant reverts to its shelf price"
                    className="rounded p-1 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </GlassCard>
  );
}

/* ------------------------------------------------------------------------- */

function CreateDialog({
  open, onClose, onCreated, onError,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (l: PriceList) => void;
  onError: (m: string) => void;
}): JSX.Element {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const create = useMutation({
    mutationFn: () =>
      createPriceList({ code: code.trim().toUpperCase(), name: name.trim() }),
    onSuccess: (l) => {
      setCode('');
      setName('');
      onCreated(l);
      onClose();
    },
    onError: (e) =>
      onError(e instanceof ApiError ? e.message : 'Could not create the price list.'),
  });

  return (
    <Modal open={open} onClose={onClose} title="New price list">
      <div className="space-y-3">
        <Input
          label="Code"
          placeholder="WHOLESALE"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          hint="Short and permanent — used in reports."
        />
        <Input
          label="Name"
          placeholder="Wholesale"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!code.trim() || !name.trim()}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}
