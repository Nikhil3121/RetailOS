/**
 * Size × colour matrix generator.
 *
 * A shirt in 5 sizes and 4 colours is 20 variants. Typing 20 rows by hand — each
 * with a name, SKU, barcode, MRP and price — is the single most tedious thing in
 * this application, and the one a shopkeeper hits in their first hour.
 *
 * NO DATABASE CHANGE WAS NEEDED. `product_variants.attributes` is already a JSON
 * column carrying {"size": "M", "color": "Navy"}, and it is already served
 * through the API. Only the screen was missing.
 *
 * Generated rows are handed back for the caller to append — this component never
 * saves. That keeps the product editor the single thing that knows how to
 * persist a variant.
 */

import { useMemo, useState } from 'react';
import { Grid3x3, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { VariantCreateBody } from '@/lib/catalog-api';
import { cn } from '@/lib/cn';

/** The sizes a garment shop reaches for first. Editable, not enforced. */
const COMMON_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export interface MatrixResult {
  variants: VariantCreateBody[];
}

export function VariantMatrix({
  open, onClose, productName, skuPrefix, onGenerate,
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
  /** Seeds each generated SKU so they are unique and readable. */
  skuPrefix: string;
  onGenerate: (variants: VariantCreateBody[]) => void;
}): JSX.Element {
  const [sizes, setSizes] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [sizeDraft, setSizeDraft] = useState('');
  const [colorDraft, setColorDraft] = useState('');
  const [mrp, setMrp] = useState('0.00');
  const [price, setPrice] = useState('0.00');
  const [cost, setCost] = useState('0.00');

  /**
   * Every combination. A dimension left empty drops out rather than producing
   * nothing — a shop with colours but no sizes still wants its four rows.
   */
  const combos = useMemo(() => {
    const s = sizes.length > 0 ? sizes : [null];
    const c = colors.length > 0 ? colors : [null];
    if (sizes.length === 0 && colors.length === 0) return [];
    return s.flatMap((size) => c.map((color) => ({ size, color })));
  }, [sizes, colors]);

  function add(list: string[], set: (v: string[]) => void, raw: string): void {
    const value = raw.trim();
    // Case-insensitive so "navy" and "Navy" cannot both end up on the product.
    if (!value || list.some((x) => x.toLowerCase() === value.toLowerCase())) return;
    set([...list, value]);
  }

  function generate(): void {
    const clean = (v: string) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
    onGenerate(
      combos.map(({ size, color }) => {
        const parts = [color, size].filter(Boolean) as string[];
        const suffix = parts.map(clean).join('-');
        return {
          name: parts.join(' / ') || 'Default',
          sku: `${skuPrefix}-${suffix}`,
          barcode: '',
          cost_price: cost,
          mrp,
          selling_price: price,
          reorder_point: '0.000',
          reorder_quantity: '0.000',
          overstock_point: null,
          is_active: true,
          // The reason this needed no migration.
          attributes: {
            ...(size ? { size } : {}),
            ...(color ? { color } : {}),
          },
        };
      }),
    );
    setSizes([]);
    setColors([]);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Generate size and colour variants">
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Pick sizes and colours for {productName || 'this product'}. Every
          combination becomes its own variant with its own SKU — scan-ready, and
          priced individually afterwards if they differ.
        </p>

        <Dimension
          label="Sizes"
          values={sizes}
          onRemove={(v) => setSizes(sizes.filter((x) => x !== v))}
          draft={sizeDraft}
          setDraft={setSizeDraft}
          onAdd={() => { add(sizes, setSizes, sizeDraft); setSizeDraft(''); }}
          suggestions={COMMON_SIZES.filter((x) => !sizes.includes(x))}
          onSuggest={(v) => add(sizes, setSizes, v)}
          placeholder="S, M, 32, 38…"
        />

        <Dimension
          label="Colours"
          values={colors}
          onRemove={(v) => setColors(colors.filter((x) => x !== v))}
          draft={colorDraft}
          setDraft={setColorDraft}
          onAdd={() => { add(colors, setColors, colorDraft); setColorDraft(''); }}
          suggestions={[]}
          onSuggest={() => {}}
          placeholder="Navy, Maroon, Cream…"
        />

        <div className="grid grid-cols-3 gap-3">
          <Input label="Cost" type="number" step="0.01" min="0"
                 value={cost} onChange={(e) => setCost(e.target.value)} />
          <Input label="MRP" type="number" step="0.01" min="0"
                 value={mrp} onChange={(e) => setMrp(e.target.value)} />
          <Input label="Selling price" type="number" step="0.01" min="0"
                 value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <p className="text-xs text-slate-500">
          Applied to every generated row. Edit individual rows afterwards where
          they differ — a larger size often costs more.
        </p>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-sm text-slate-400">
            {combos.length === 0
              ? 'Add at least one size or colour.'
              : `${combos.length} variant${combos.length === 1 ? '' : 's'} will be created`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              disabled={combos.length === 0}
              leadingIcon={<Grid3x3 className="h-4 w-4" />}
              onClick={generate}
            >
              Generate
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Dimension({
  label, values, onRemove, draft, setDraft, onAdd, suggestions, onSuggest, placeholder,
}: {
  label: string;
  values: string[];
  onRemove: (v: string) => void;
  draft: string;
  setDraft: (v: string) => void;
  onAdd: () => void;
  suggestions: string[];
  onSuggest: (v: string) => void;
  placeholder: string;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-slate-400">{label}</div>

      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-surface-muted px-2 py-1 text-xs text-slate-100"
            >
              {v}
              <button
                type="button"
                onClick={() => onRemove(v)}
                aria-label={`Remove ${v}`}
                className="rounded text-slate-500 hover:text-rose-300"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds, because this is a list you build by typing.
            if (e.key === 'Enter') { e.preventDefault(); onAdd(); }
          }}
          placeholder={placeholder}
          className="h-9 flex-1 rounded-lg border border-border-strong bg-surface-muted px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25"
        />
        <Button size="sm" variant="secondary" leadingIcon={<Plus className="h-3.5 w-3.5" />} onClick={onAdd}>
          Add
        </Button>
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onSuggest(v)}
              className={cn(
                'rounded-md border border-border px-2 py-0.5 text-xs text-slate-400',
                'hover:border-brand-600 hover:text-brand-400',
              )}
            >
              + {v}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
