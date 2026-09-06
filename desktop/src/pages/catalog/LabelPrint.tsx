/**
 * Barcode label printing.
 *
 * Until now the shop could SCAN a barcode but never make one, so a newly
 * arrived garment had no tag and could only be billed by searching its name.
 *
 * WHY BROWSER PRINTING RATHER THAN ESC/POS
 * ----------------------------------------
 * The thermal path in `electron/printing` speaks ESC/POS, which is a RECEIPT
 * language — it has no concept of an N-up sheet of labels. Label printers
 * speak EPL/ZPL/TSPL instead, and each model differs.
 *
 * Rendering an HTML sheet and printing it through the operating system works
 * with every one of them, plus a plain A4 sheet of sticker paper, because
 * Windows already has the driver. It is also the only version of this that can
 * be checked without owning the hardware — the sheet is inspectable in a
 * browser at exactly the size it will print.
 *
 * The legacy system stored raw EPL in `BARDESDET`, which locked it to one
 * printer model. This deliberately does not.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, Search, Tag } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import { code128Svg, isEncodable } from '@/lib/barcode';
import { formatMoney } from '@/lib/money';
import { getProduct, listProducts, type ProductSummary } from '@/lib/catalog-api';

/** A row queued for printing: which SKU, and how many stickers of it. */
interface LabelRow {
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  mrp: string;
  count: number;
}

/**
 * Label sizes, in millimetres.
 *
 * 38 × 25 is the common Indian garment tag; 50 × 25 suits a shelf edge. Sizes
 * are given in mm and printed with mm CSS so the sheet comes out at true
 * physical size regardless of screen dpi — a label scaled by the browser is a
 * label a scanner cannot read.
 */
const SIZES = [
  { value: '38x25', label: '38 × 25 mm (garment tag)', w: 38, h: 25, module: 1.6 },
  { value: '50x25', label: '50 × 25 mm (shelf edge)', w: 50, h: 25, module: 2 },
  { value: '75x50', label: '75 × 50 mm (carton)', w: 75, h: 50, module: 3 },
] as const;

export function LabelPrint(): JSX.Element {
  const [search, setSearch] = useState('');
  const [size, setSize] = useState<string>('38x25');
  const [rows, setRows] = useState<LabelRow[]>([]);
  const [showPrice, setShowPrice] = useState(true);

  const productsQuery = useQuery({
    queryKey: ['products', 'labels', search],
    queryFn: () => listProducts({ page: 1, page_size: 40, search: search || undefined }),
  });

  const spec = SIZES.find((s) => s.value === size) ?? SIZES[0];

  // Which product's variants are open. A garment needs a label PER SIZE AND
  // COLOUR, so the list expands rather than adding "one Cotton Saree" — a
  // single tag for a product with forty SKUs would be useless.
  const [openProduct, setOpenProduct] = useState<ProductSummary | null>(null);
  const variantsQuery = useQuery({
    queryKey: ['product', openProduct?.id],
    queryFn: () => getProduct(openProduct!.id),
    enabled: Boolean(openProduct),
  });

  function addVariant(
    product: ProductSummary,
    v: { id: string; sku: string; barcode: string | null; name: string; mrp: string },
    by = 1,
  ): void {
    setRows((prev) => {
      const existing = prev.find((r) => r.variantId === v.id);
      if (existing) {
        return prev.map((r) =>
          r.variantId === v.id ? { ...r, count: r.count + by } : r,
        );
      }
      return [
        ...prev,
        {
          variantId: v.id,
          // The printed code is the barcode when one is set, otherwise the SKU.
          // Never invent a value: a tag whose code is not in the catalogue
          // scans to nothing at the till.
          sku: v.barcode || v.sku,
          productName: product.name,
          variantName: v.name,
          mrp: v.mrp ?? '0',
          count: by,
        },
      ];
    });
  }

  const total = rows.reduce((n, r) => n + r.count, 0);

  // Every sticker, expanded — a row asking for 12 becomes 12 labels.
  const labels = useMemo(
    () => rows.flatMap((r) => Array.from({ length: r.count }, () => r)),
    [rows],
  );

  // A SKU the symbology cannot carry must be caught BEFORE the sheet is sent
  // to a printer, or the shop gets a page of blanks and wasted sticker paper.
  const unprintable = rows.filter((r) => !isEncodable(r.sku));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Barcode labels"
        description="Print price tags for new stock. Any label printer or a sheet of sticker paper."
        actions={
          <Button
            leadingIcon={<Printer className="h-4 w-4" />}
            disabled={total === 0 || unprintable.length > 0}
            onClick={() => window.print()}
          >
            Print {total > 0 ? `${total} label${total === 1 ? '' : 's'}` : ''}
          </Button>
        }
      />

      {/* ---- everything below is hidden when printing ---- */}
      <div className="no-print space-y-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GlassCard className="p-4">
            <Input
              leadingIcon={<Search className="h-4 w-4" />}
              placeholder="Search a product by name or SKU"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {productsQuery.isError ? (
              <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {productsQuery.error instanceof ApiError
                  ? productsQuery.error.message
                  : 'Could not load products.'}
              </div>
            ) : (
              <ul className="mt-3 max-h-80 divide-y divide-border overflow-y-auto text-sm">
                {(productsQuery.data?.items ?? []).map((p) => (
                  <li key={p.id} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-slate-200">{p.name}</div>
                        <div className="text-xs text-slate-500">
                          {p.variant_count} size/colour
                          {p.variant_count === 1 ? '' : 's'}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setOpenProduct((cur) => (cur?.id === p.id ? null : p))
                        }
                      >
                        {openProduct?.id === p.id ? 'Close' : 'Choose'}
                      </Button>
                    </div>

                    {openProduct?.id === p.id && (
                      <ul className="mt-2 space-y-1 border-l border-border pl-3">
                        {variantsQuery.isLoading && (
                          <li className="text-xs text-slate-500">Loading sizes…</li>
                        )}
                        {variantsQuery.isError && (
                          <li className="text-xs text-rose-300">
                            Could not load this product's sizes.
                          </li>
                        )}
                        {(variantsQuery.data?.variants ?? []).map((v) => (
                          <li key={v.id} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-xs text-slate-300">
                              {v.name}
                              <span className="ml-2 font-mono text-slate-500">
                                {v.barcode || v.sku}
                              </span>
                            </span>
                            <Button size="sm" variant="ghost"
                                    onClick={() => addVariant(p, v)}>
                              Add
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>

          <GlassCard className="p-4">
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Label size"
                options={SIZES.map((s) => ({ label: s.label, value: s.value }))}
                value={size}
                onChange={(e) => setSize(e.target.value)}
              />
              <div className="flex items-end pb-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={showPrice}
                    onChange={(e) => setShowPrice(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Print the MRP on the tag
                </label>
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                Nothing queued. Search for a product and click Add.
              </p>
            ) : (
              <ul className="mt-4 max-h-72 divide-y divide-border overflow-y-auto text-sm">
                {rows.map((r) => (
                  <li key={r.variantId} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-slate-200">
                        {r.productName}
                        <span className="ml-2 text-xs text-slate-500">{r.variantName}</span>
                      </div>
                      <div className="font-mono text-xs text-slate-500">{r.sku}</div>
                    </div>
                    <Input
                      className="w-20"
                      inputMode="numeric"
                      value={String(r.count)}
                      onChange={(e) => {
                        const n = Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0);
                        setRows((prev) =>
                          prev
                            .map((x) => (x.variantId === r.variantId ? { ...x, count: n } : x))
                            .filter((x) => x.count > 0),
                        );
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}

            {unprintable.length > 0 && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
              >
                These codes cannot be turned into a barcode — they contain
                characters the symbology does not carry:{' '}
                {unprintable.map((r) => r.sku).join(', ')}
              </div>
            )}
          </GlassCard>
        </div>

        {total > 0 && (
          <p className="text-xs text-slate-500">
            {total} label{total === 1 ? '' : 's'} at {spec.w} × {spec.h} mm. The preview
            below is actual size — hold a ruler to your screen if you are unsure the
            printer is scaling correctly.
          </p>
        )}
      </div>

      {/* ---- the sheet. This is what prints ---- */}
      <div className="label-sheet">
        {labels.map((r, i) => (
          <div
            key={`${r.variantId}-${i}`}
            className="label"
            style={{ width: `${spec.w}mm`, height: `${spec.h}mm` }}
          >
            <div className="label-name">
              {r.productName}
              {r.variantName && r.variantName !== 'Default' ? ` · ${r.variantName}` : ''}
            </div>
            <div
              className="label-code"
              // The SVG is generated here, not fetched — no network on a print path.
              dangerouslySetInnerHTML={{
                __html: isEncodable(r.sku)
                  ? code128Svg(r.sku, { moduleWidth: spec.module, height: spec.h * 1.2 })
                  : '',
              }}
            />
            {showPrice && Number(r.mrp) > 0 && (
              <div className="label-price">MRP {formatMoney(r.mrp)}</div>
            )}
          </div>
        ))}
      </div>

      {labels.length === 0 && (
        <GlassCard className="no-print flex items-center gap-3 py-8 text-slate-500">
          <Tag className="h-5 w-5" />
          Labels you queue will preview here at their real printed size.
        </GlassCard>
      )}
    </div>
  );
}
