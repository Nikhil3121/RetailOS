import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Filter, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import {
  deleteProduct,
  listBrands,
  listCategories,
  listProducts,
  type ProductSummary,
} from '@/lib/catalog-api';

export function Products(): JSX.Element {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [brandId, setBrandId] = useState<string>('');
  const [confirmDelete, setConfirmDelete] = useState<ProductSummary | null>(null);

  const productsQuery = useQuery({
    queryKey: ['products', { search, categoryId, brandId }],
    queryFn: () =>
      listProducts({
        search: search.trim() || undefined,
        category_id: categoryId || undefined,
        brand_id: brandId || undefined,
        page: 1,
        page_size: 100,
      }),
  });
  const brandsQuery = useQuery({ queryKey: ['brands'], queryFn: () => listBrands(1, 500) });
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => listCategories(1, 500) });

  const remove = useMutation({
    mutationFn: (p: ProductSummary) => deleteProduct(p.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });

  const columns = useMemo<Column<ProductSummary>[]>(
    () => [
      {
        key: 'name',
        header: 'Product',
        cell: (p) => (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03] text-slate-300">
              <Boxes className="h-4 w-4" />
            </span>
            <div>
              <Link
                to={`/products/${p.id}`}
                className="font-medium text-white hover:text-cobalt-200"
              >
                {p.name}
              </Link>
              {p.primary_sku && (
                <div className="font-mono text-xs text-slate-500">{p.primary_sku}</div>
              )}
            </div>
          </div>
        ),
      },
      {
        key: 'variants',
        header: 'Variants',
        align: 'right',
        cell: (p) => <span className="font-mono text-slate-300">{p.variant_count}</span>,
      },
      {
        key: 'price',
        header: 'Price',
        align: 'right',
        cell: (p) =>
          p.primary_selling_price ? (
            <span className="font-mono text-slate-100">₹{p.primary_selling_price}</span>
          ) : (
            <span className="text-slate-500">—</span>
          ),
      },
      {
        key: 'tax',
        header: 'GST',
        align: 'right',
        cell: (p) => <span className="font-mono text-slate-400">{p.tax_rate}%</span>,
      },
      {
        key: 'hsn',
        header: 'HSN',
        cell: (p) =>
          p.hsn_code ? (
            <span className="font-mono text-xs text-slate-300">{p.hsn_code}</span>
          ) : (
            <span className="text-slate-500">—</span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (p) =>
          p.is_active ? (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">
              Active
            </span>
          ) : (
            <span className="rounded-full border border-border bg-white/[0.02] px-2 py-1 text-xs text-slate-400">
              Inactive
            </span>
          ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: (p) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => navigate(`/products/${p.id}`)}>
              Edit
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(p)}>
              Delete
            </Button>
          </div>
        ),
      },
    ],
    [navigate],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Everything you sell. Each product carries one or more variants (SKUs)."
        actions={
          <Button
            leadingIcon={<Plus className="h-4 w-4" />}
            onClick={() => navigate('/products/new')}
          >
            New product
          </Button>
        }
      />

      <div className="glass inline-flex w-fit max-w-full flex-wrap items-end gap-3 px-3 py-2">
        <div className="min-w-[240px] flex-1">
          <Input
            placeholder="Search by name, SKU, barcode, or HSN"
            leadingIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="min-w-[200px] flex-1">
          <Select
            placeholder="— All categories —"
            options={(categoriesQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id }))}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          />
        </div>
        <div className="min-w-[200px] flex-1">
          <Select
            placeholder="— All brands —"
            options={(brandsQuery.data?.items ?? []).map((b) => ({ label: b.name, value: b.id }))}
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
          />
        </div>
        {(search || categoryId || brandId) && (
          <Button
            variant="ghost"
            leadingIcon={<Filter className="h-4 w-4" />}
            onClick={() => {
              setSearch('');
              setCategoryId('');
              setBrandId('');
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {productsQuery.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {productsQuery.error instanceof ApiError
            ? productsQuery.error.message
            : 'Failed to load products.'}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={productsQuery.data?.items ?? []}
        rowKey={(p) => p.id}
        empty={
          productsQuery.isLoading
            ? 'Loading…'
            : search || categoryId || brandId
              ? 'No products match those filters.'
              : 'No products yet. Create your first product to get started.'
        }
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete product"
        description={`Delete "${confirmDelete?.name}" and every variant? This cannot be undone.`}
        destructive
        confirmLabel="Delete"
        onConfirm={async () => {
          if (confirmDelete) await remove.mutateAsync(confirmDelete);
        }}
      />
    </div>
  );
}
