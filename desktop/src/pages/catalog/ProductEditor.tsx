import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFieldArray, useForm } from "react-hook-form";
import {
  Grid3x3,
  ArrowLeft,
  Image as ImageIcon,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { VariantMatrix } from "@/components/catalog/VariantMatrix";
import { ConfirmWithPassword } from "@/components/ui/ConfirmWithPassword";
import { GlassCard } from "@/components/ui/GlassCard";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Tabs } from "@/components/ui/Tabs";
import { Textarea } from "@/components/ui/Textarea";
import { ApiError } from "@/lib/api";
import {
  addImage,
  addVariant,
  createProduct,
  deleteImage,
  deleteVariant,
  getProduct,
  listBrands,
  listCategories,
  listUnits,
  updateProduct,
  updateVariant,
  type ProductCreateBody,
  type VariantCreateBody,
} from "@/lib/catalog-api";

interface FormValues {
  name: string;
  description: string;
  hsn_code: string;
  tax_rate: string;
  brand_id: string;
  category_id: string;
  unit_id: string;
  purchase_unit_id?: string | null;
  purchase_conversion?: string;
  is_active: boolean;
  variants: Array<VariantCreateBody & { id?: string }>;
}

const EMPTY_VARIANT = (): VariantCreateBody => ({
  name: "Default Variant",
  sku: `SKU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  barcode: "",
  cost_price: "0.00",
  mrp: "0.00",
  selling_price: "0.00",
  reorder_point: "0.000",
  reorder_quantity: "0.000",
  overstock_point: null,
  is_active: true,
});
export function ProductEditor(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [tab, setTab] = useState<"details" | "variants" | "images">("details");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const productQuery = useQuery({
    queryKey: ["product", id],
    queryFn: () => getProduct(id!),
    enabled: !isNew,
  });

  const brandsQuery = useQuery({
    queryKey: ["brands"],
    queryFn: () => listBrands(1, 200),
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => listCategories(1, 200),
  });
  const unitsQuery = useQuery({
    queryKey: ["units"],
    queryFn: () => listUnits(1, 200),
  });

  const form = useForm<FormValues>({
    defaultValues: {
      name: "",
      description: "",
      hsn_code: "",
      tax_rate: "0.00",
      brand_id: "",
      category_id: "",
      unit_id: "",
      purchase_unit_id: "",
      purchase_conversion: "1",
      is_active: true,
      variants: [EMPTY_VARIANT()],
    },
  });
  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors },
  } = form;
  const [matrixOpen, setMatrixOpen] = useState(false);
  const { fields, append, remove } = useFieldArray({
    control,
    name: "variants",
  });

  // Hydrate the form once the product loads.
  useEffect(() => {
    if (!productQuery.data) return;
    const p = productQuery.data;
    reset({
      name: p.name,
      description: p.description ?? "",
      hsn_code: p.hsn_code ?? "",
      tax_rate: p.tax_rate,
      brand_id: p.brand_id ?? "",
      category_id: p.category_id ?? "",
      unit_id: p.unit_id,
      purchase_unit_id: p.purchase_unit_id ?? "",
      purchase_conversion: p.purchase_conversion ?? "1",
      is_active: p.is_active,
      variants: p.variants.map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku,
        barcode: v.barcode ?? "",
        cost_price: v.cost_price,
        mrp: v.mrp,
        selling_price: v.selling_price,
        reorder_point: v.reorder_point,
        reorder_quantity: v.reorder_quantity,
        overstock_point: v.overstock_point,
        is_active: v.is_active,
      })),
    });
  }, [productQuery.data, reset]);

  const brandOptions = (brandsQuery.data?.items ?? []).map((b) => ({
    label: b.name,
    value: b.id,
  }));
  const categoryOptions = (categoriesQuery.data?.items ?? []).map((c) => ({
    label: c.name,
    value: c.id,
  }));
  const unitOptions = (unitsQuery.data?.items ?? []).map((u) => ({
    label: `${u.name} · ${u.symbol}`,
    value: u.id,
  }));

  async function onSubmit(values: FormValues): Promise<void> {
    setError(null);
    setSaving(true);
    try {
      // react-hook-form returns "" (empty string) for numeric <Input>s the user
      // has cleared, and `??` doesn't replace "" — only null/undefined. Send
      // "" as-is and Pydantic rejects the whole payload with 422. Coerce here.
      const num = (v: unknown, fallback: string): string => {
        const s = String(v ?? "").trim();
        return s === "" ? fallback : s;
      };
      const numOrNull = (v: unknown): string | null => {
        const s = String(v ?? "").trim();
        return s === "" ? null : s;
      };
      const cleanVariant = (v: VariantCreateBody): VariantCreateBody => ({
        name: v.name.trim(),
        sku: v.sku.trim().toUpperCase(),
        barcode: v.barcode?.trim() || null,
        cost_price: num(v.cost_price, "0.00"),
        mrp: num(v.mrp, "0.00"),
        selling_price: num(v.selling_price, "0.00"),
        reorder_point: num(v.reorder_point, "0.000"),
        reorder_quantity: num(v.reorder_quantity, "0.000"),
        overstock_point: numOrNull(v.overstock_point),
        is_active: v.is_active,
      });

      if (isNew) {
        const body: ProductCreateBody = {
          name: values.name.trim(),
          description: values.description.trim() || null,
          hsn_code: values.hsn_code.trim() || null,
          tax_rate: num(values.tax_rate, "0.00"),
          brand_id: values.brand_id || null,
          category_id: values.category_id || null,
          unit_id: values.unit_id,
          purchase_unit_id: values.purchase_unit_id || null,
          purchase_conversion: values.purchase_unit_id
            ? num(values.purchase_conversion, "1")
            : "1",
          is_active: values.is_active,
          variants: values.variants.map(cleanVariant),
        };
        const created = await createProduct(body);
        qc.invalidateQueries({ queryKey: ["products"] });
        navigate(`/products/${created.id}`, { replace: true });
      } else {
        await updateProduct(id!, {
          name: values.name.trim(),
          description: values.description.trim() || null,
          hsn_code: values.hsn_code.trim() || null,
          tax_rate: num(values.tax_rate, "0.00"),
          brand_id: values.brand_id || null,
          category_id: values.category_id || null,
          unit_id: values.unit_id,
          purchase_unit_id: values.purchase_unit_id || null,
          purchase_conversion: values.purchase_unit_id
            ? num(values.purchase_conversion, "1")
            : "1",
          is_active: values.is_active,
        });
        // Persist variant changes one at a time — the update endpoint is per-variant.
        for (const v of values.variants) {
          if (!v.id) continue;
          await updateVariant(v.id, cleanVariant(v));
        }
        qc.invalidateQueries({ queryKey: ["products"] });
        qc.invalidateQueries({ queryKey: ["product", id] });
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to save product.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isNew ? "New product" : (productQuery.data?.name ?? "Product")}
        description={
          isNew
            ? "Create a product with one or more sellable variants."
            : "Edit product details, variants, and images."
        }
        actions={
          <div className="flex gap-2">
            <Button
              variant="ghost"
              leadingIcon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => navigate("/products")}
            >
              Back
            </Button>
            <Button
              loading={saving}
              leadingIcon={<Save className="h-4 w-4" />}
              onClick={handleSubmit(onSubmit)}
            >
              {isNew ? "Create product" : "Save changes"}
            </Button>
          </div>
        }
      />

      {(productQuery.isError || error) && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error ??
            (productQuery.error instanceof ApiError
              ? productQuery.error.message
              : "Failed to load product.")}
        </div>
      )}

      <Tabs
        items={[
          { id: "details", label: "Details" },
          { id: "variants", label: "Variants", count: fields.length },
          {
            id: "images",
            label: "Images",
            count: productQuery.data?.images.length ?? 0,
          },
        ]}
        activeId={tab}
        onChange={(id) => setTab(id as typeof tab)}
      />

      {tab === "details" && (
        <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <GlassCard>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Name"
                error={errors.name?.message}
                {...register("name", { required: "Name is required" })}
              />
              <Select
                label="Base unit"
                placeholder="— Select a unit —"
                options={unitOptions}
                error={errors.unit_id?.message}
                hint="Stock is always counted in this unit."
                {...register("unit_id", { required: "Unit is required" })}
              />
            </div>

            {/*
              Buying unit vs stocking unit.

              A wholesaler receives 20 cartons of 12 and sells single pieces.
              Entering the conversion here means the receiving bay types "20"
              and the ledger records 240 — the arithmetic happens once, on the
              server, instead of in someone's head at the loading door.
            */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Select
                label="Bought in (optional)"
                placeholder="— Same as base unit —"
                options={unitOptions}
                hint="The unit goods arrive in, if it differs."
                {...register("purchase_unit_id")}
              />
              <Input
                label="Base units per purchase unit"
                type="number"
                step="0.0001"
                min="0.0001"
                placeholder="1"
                hint="1 carton = 12 pieces → enter 12."
                {...register("purchase_conversion")}
              />
            </div>
            <div className="mt-4">
              <Textarea
                label="Description"
                rows={4}
                {...register("description")}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Select
                label="Brand"
                placeholder="— None —"
                options={brandOptions}
                {...register("brand_id")}
              />
              <Select
                label="Category"
                placeholder="— None —"
                options={categoryOptions}
                {...register("category_id")}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Input
                label="HSN code"
                hint="India GST classification (optional)"
                {...register("hsn_code")}
              />
              <Input
                label="Tax rate (%)"
                type="number"
                step="0.01"
                min="0"
                max="100"
                {...register("tax_rate")}
              />
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                className="accent-cobalt-500"
                {...register("is_active")}
              />
              Product is active
            </label>
          </GlassCard>
        </form>
      )}

      {tab === "variants" && (
        <div className="space-y-4">
          {fields.map((field, idx) => (
            <GlassCard key={field.id}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Sparkles className="h-4 w-4 text-cobalt-300" />
                  Variant #{idx + 1}
                </div>
                {fields.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={async () => {
                      const v = fields[idx] as unknown as { id?: string };
                      if (v.id && !isNew) {
                        try {
                          await deleteVariant(v.id);
                        } catch (err) {
                          setError(
                            err instanceof ApiError
                              ? err.message
                              : "Failed to delete variant.",
                          );
                          return;
                        }
                      }
                      remove(idx);
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <Input
                  label="Variant name"
                  {...register(`variants.${idx}.name` as const, {
                    required: true,
                  })}
                />
                <Input
                  label="SKU"
                  {...register(`variants.${idx}.sku` as const, {
                    required: true,
                  })}
                />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4">
                <Input
                  label="Barcode"
                  placeholder="Optional"
                  {...register(`variants.${idx}.barcode` as const)}
                />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4">
                <Input
                  label="Cost price"
                  type="number"
                  step="0.01"
                  min="0"
                  {...register(`variants.${idx}.cost_price` as const)}
                />
                <Input
                  label="MRP"
                  type="number"
                  step="0.01"
                  min="0"
                  {...register(`variants.${idx}.mrp` as const)}
                />
                <Input
                  label="Selling price"
                  type="number"
                  step="0.01"
                  min="0"
                  {...register(`variants.${idx}.selling_price` as const)}
                />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4">
                <Input
                  label="Reorder point"
                  type="number"
                  step="0.001"
                  min="0"
                  hint="Trigger low-stock alert at or below"
                  {...register(`variants.${idx}.reorder_point` as const)}
                />
                <Input
                  label="Reorder quantity"
                  type="number"
                  step="0.001"
                  min="0"
                  hint="Suggested top-up buffer"
                  {...register(`variants.${idx}.reorder_quantity` as const)}
                />
                <Input
                  label="Overstock point"
                  type="number"
                  step="0.001"
                  min="0"
                  hint="Optional — blank disables"
                  {...register(`variants.${idx}.overstock_point` as const)}
                />
              </div>
              <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  className="accent-cobalt-500"
                  {...register(`variants.${idx}.is_active` as const)}
                />
                Variant is active
              </label>
            </GlassCard>
          ))}

          {/* The matrix is only offered on a NEW product. On an existing one
              each variant must be created server-side one at a time, and
              generating twenty rows that then fail halfway would leave the
              catalog in a state nobody asked for. */}
          {isNew && (
            <Button
              variant="secondary"
              leadingIcon={<Grid3x3 className="h-4 w-4" />}
              onClick={() => setMatrixOpen(true)}
            >
              Size / colour matrix
            </Button>
          )}
          <Button
            variant="secondary"
            leadingIcon={<Plus className="h-4 w-4" />}
            onClick={async () => {
              if (isNew) {
                append(EMPTY_VARIANT());
                return;
              }
              try {
                const created = await addVariant(id!, EMPTY_VARIANT_FOR(id!));
                qc.invalidateQueries({ queryKey: ["product", id] });
                append({
                  ...created,
                  cost_price: created.cost_price,
                  mrp: created.mrp,
                  selling_price: created.selling_price,
                  reorder_point: created.reorder_point,
                  reorder_quantity: created.reorder_quantity,
                  overstock_point: created.overstock_point,
                });
              } catch (err) {
                setError(
                  err instanceof ApiError
                    ? err.message
                    : "Failed to add variant.",
                );
              }
            }}
          >
            Add variant
          </Button>
        </div>
      )}

      {tab === "images" && !isNew && <ImagesTab productId={id!} />}
      {tab === "images" && isNew && (
        <GlassCard>
          <div className="flex flex-col items-center py-8 text-center">
            <ImageIcon className="mb-3 h-8 w-8 text-slate-500" />
            <p className="text-sm text-slate-400">
              Save the product first, then add images from this tab.
            </p>
          </div>
        </GlassCard>
      )}

      <VariantMatrix
        open={matrixOpen}
        onClose={() => setMatrixOpen(false)}
        productName={watch("name")}
        skuPrefix={
          (watch("name") || "SKU").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6) ||
          "SKU"
        }
        onGenerate={(generated) => {
          // Replace the placeholder default row rather than leaving an empty
          // "Default Variant" sitting beside twenty real ones.
          const onlyPlaceholder =
            fields.length === 1 &&
            !watch("variants.0.barcode") &&
            watch("variants.0.name") === "Default Variant";
          if (onlyPlaceholder) remove(0);
          generated.forEach((v) => append(v));
        }}
      />
    </div>
  );
}

function EMPTY_VARIANT_FOR(_productId: string): VariantCreateBody {
  return {
    name: "New variant",
    sku: `SKU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    cost_price: "0.00",
    mrp: "0.00",
    selling_price: "0.00",
    is_active: true,
  };
}

function ImagesTab({ productId }: { productId: string }): JSX.Element {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    url: string;
  } | null>(null);

  const productQuery = useQuery({
    queryKey: ["product", productId],
    queryFn: () => getProduct(productId),
  });

  const add = useMutation({
    mutationFn: () =>
      addImage(productId, { url: url.trim(), alt_text: alt.trim() || null }),
    onSuccess: () => {
      setUrl("");
      setAlt("");
      qc.invalidateQueries({ queryKey: ["product", productId] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Failed to add image."),
  });

  const remove = useMutation({
    mutationFn: (imageId: string) => deleteImage(imageId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["product", productId] }),
  });

  return (
    <div className="space-y-4">
      <GlassCard>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[280px] flex-1">
            <Input
              label="Image URL"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <Input
              label="Alt text"
              placeholder="Optional"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
            />
          </div>
          <Button
            loading={add.isPending}
            onClick={() => add.mutate()}
            disabled={!url.trim()}
          >
            Add image
          </Button>
        </div>
        {error && (
          <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          File uploads land in Phase 4 with object storage. Until then, host
          images elsewhere and paste the URL.
        </p>
      </GlassCard>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {(productQuery.data?.images ?? []).map((img) => (
          <div key={img.id} className="glass overflow-hidden p-0">
            <div className="relative aspect-square bg-ink-800">
              <img
                src={img.url}
                alt={img.alt_text ?? ""}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.opacity = "0.2";
                }}
              />
            </div>
            <div className="flex items-center justify-between p-3">
              <div className="truncate text-xs text-slate-400">
                {img.alt_text || "Untitled"}
              </div>
              <Button
                size="sm"
                variant="danger"
                onClick={() => setConfirmDelete({ id: img.id, url: img.url })}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        {productQuery.data && productQuery.data.images.length === 0 && (
          <div className="glass col-span-full p-8 text-center text-sm text-slate-500">
            No images yet.
          </div>
        )}
      </div>

      <ConfirmWithPassword
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Remove image"
        description="This only removes the URL reference — the actual image at the URL is untouched."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (confirmDelete) await remove.mutateAsync(confirmDelete.id);
        }}
      />
    </div>
  );
}
