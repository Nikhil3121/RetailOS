/**
 * NewBillScreen — mobile POS core loop, fully-featured version.
 *
 * Flow:
 *   1. Store auto-picks the branch with an open day session
 *   2. Search or SCAN a barcode via the phone camera → pick from results
 *   3. Cart supports qty +/- and remove; totals are tax-INCLUSIVE
 *   4. Attach a customer, salesperson code, notes
 *   5. Hold the bill (parks to AsyncStorage) or Save via Payment Sheet
 *      (cash + UPI + card + partial splits allowed)
 *   6. If navigation param `resumeHeldId` is passed, we load that snapshot
 *      into the cart on mount (from HeldBillsScreen → Resume)
 */

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Minus, Plus, ScanBarcode, Trash2, User } from 'lucide-react-native';

import { BarcodeScannerModal } from '@/components/BarcodeScannerModal';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { CustomerPickerModal } from '@/components/CustomerPickerModal';
import { GlassCard } from '@/components/GlassCard';
import { Input } from '@/components/Input';
import { PageHeader } from '@/components/PageHeader';
import { PaymentSheet } from '@/components/PaymentSheet';
import { useDebounce } from '@/hooks/useDebounce';
import { getProduct, listProducts, listStores } from '@/api/catalog-api';
import { currentSession } from '@/api/day-sessions-api';
import { createSale } from '@/api/sales-api';
import { inr, round2 } from '@/lib/money';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuthStore } from '@/stores/auth-store';
import { useHeldBillsStore } from '@/stores/held-bills-store';
import type { Customer } from '@/types/customer';
import type { SaleCreate, SaleLineInput, SalePaymentInput } from '@/types/sale';
import type { BillingStackParamList } from '@/navigation/stacks/BillingStack';

interface CartLine {
  variant_id: string;
  sku: string;
  product_name: string;
  variant_name: string;
  unit_price: string;
  tax_rate: string;
  quantity: number;
}

export function NewBillScreen(): React.JSX.Element {
  const route = useRoute<RouteProp<BillingStackParamList, 'NewBill'>>();
  const navigation = useNavigation<NativeStackNavigationProp<BillingStackParamList>>();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  // Held bills — count for the header pill + resume/hold actions
  const heldBills = useHeldBillsStore((s) => s.bills);
  const holdBillFn = useHeldBillsStore((s) => s.hold);
  const resumeBillFn = useHeldBillsStore((s) => s.resume);

  // Stores + auto-select the one with an open session
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const allStores = storesQuery.data?.items ?? [];
  const [storeId, setStoreId] = useState<string>(user?.store_id ?? '');
  const sessionProbes = useQueries({
    queries: allStores.map((s) => ({
      queryKey: ['day-session', 'current', s.id],
      queryFn: () => currentSession(s.id),
      staleTime: 0,
      refetchOnMount: 'always' as const,
    })),
  });
  const openStoreIds = allStores
    .map((s, i) => (sessionProbes[i]?.data?.status === 'open' ? s.id : null))
    .filter((x): x is string => !!x);
  useEffect(() => {
    if (openStoreIds.includes(storeId)) return;
    if (openStoreIds.length === 1) setStoreId(openStoreIds[0]);
    else if (!storeId && allStores.length > 0) setStoreId(allStores[0].id);
  }, [openStoreIds, storeId, allStores]);
  const sessionOpen = openStoreIds.includes(storeId);
  const activeStore = allStores.find((s) => s.id === storeId);

  // Cart + attachments
  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [notes, setNotes] = useState('');

  // Resume held bill if we got here with resumeHeldId
  useEffect(() => {
    const id = route.params?.resumeHeldId;
    if (!id) return;
    const snap = resumeBillFn(id);
    if (!snap) return;
    setLines(
      snap.lines.map((l) => ({
        variant_id: l.variant_id,
        sku: l.sku,
        product_name: l.product_name,
        variant_name: l.variant_name,
        unit_price: l.unit_price,
        tax_rate: l.tax_rate,
        quantity: l.quantity,
      })),
    );
    if (snap.notes) setNotes(snap.notes);
    // Clear param so a screen re-focus doesn't try to resume again
    navigation.setParams({ resumeHeldId: undefined });
  }, [route.params?.resumeHeldId, resumeBillFn, navigation]);

  // Product picker
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query.trim(), 250);
  const summariesQuery = useQuery({
    queryKey: ['products', 'billing', debounced],
    queryFn: () =>
      listProducts({ page_size: 20, is_active: true, search: debounced || undefined }),
    enabled: debounced.length > 0,
  });
  const summaries = summariesQuery.data?.items ?? [];

  // Scanner
  const [scannerOpen, setScannerOpen] = useState(false);

  async function addBySearchTerm(term: string): Promise<void> {
    // Prefer exact SKU/barcode hits first (scanner precision)
    const res = await listProducts({ page_size: 5, is_active: true, search: term });
    const first = res.items[0];
    if (!first) {
      Alert.alert('No match', `No product matches "${term}".`);
      return;
    }
    await addBySummaryId(first.id);
  }

  async function addBySummaryId(productId: string): Promise<void> {
    try {
      const full = await getProduct(productId);
      const v = full.variants[0];
      if (!v) return;
      setLines((cur) => {
        const idx = cur.findIndex((l) => l.variant_id === v.id);
        if (idx >= 0) {
          const next = [...cur];
          next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
          return next;
        }
        return [
          ...cur,
          {
            variant_id: v.id,
            sku: v.sku,
            product_name: full.name,
            variant_name: v.name,
            unit_price: v.selling_price,
            tax_rate: full.tax_rate,
            quantity: 1,
          },
        ];
      });
      setQuery('');
    } catch (err) {
      Alert.alert('Add failed', err instanceof Error ? err.message : String(err));
    }
  }

  function bump(variantId: string, delta: number): void {
    setLines((cur) =>
      cur
        .map((l) =>
          l.variant_id === variantId ? { ...l, quantity: Math.max(0, l.quantity + delta) } : l,
        )
        .filter((l) => l.quantity > 0),
    );
  }

  // Tax-INCLUSIVE totals — matches backend services/sale.py
  const totals = useMemo(() => {
    let gross = 0;
    let net = 0;
    let tax = 0;
    for (const l of lines) {
      const price = Number(l.unit_price) || 0;
      const lineTotal = price * l.quantity;
      const rate = Number(l.tax_rate) || 0;
      const divisor = 1 + rate / 100;
      const lineNet = divisor !== 0 ? lineTotal / divisor : lineTotal;
      gross += lineTotal;
      net += lineNet;
      tax += lineTotal - lineNet;
    }
    return { subtotal: round2(net), tax: round2(tax), grand: round2(gross) };
  }, [lines]);

  // Hold + Save
  function onHold(): void {
    if (lines.length === 0) {
      Alert.alert('Nothing to hold', 'Cart is empty.');
      return;
    }
    holdBillFn({
      store_id: storeId,
      customer_id: customer?.id ?? null,
      salesperson_id: null,
      notes,
      lines: lines.map((l) => ({ ...l })),
    });
    setLines([]);
    setNotes('');
    setCustomer(null);
    Alert.alert('Bill held', `${heldBills.length + 1} bill(s) on hold.`);
  }

  const [payOpen, setPayOpen] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async (payments: SalePaymentInput[]) => {
      if (!storeId) throw new Error('Select a store first.');
      if (!sessionOpen) throw new Error('No open day session on the selected store.');
      if (lines.length === 0) throw new Error('Cart is empty.');
      const body: SaleCreate = {
        store_id: storeId,
        customer_id: customer?.id ?? null,
        salesperson_user_id: null,
        notes: notes.trim() || null,
        lines: lines.map<SaleLineInput>((l) => ({
          variant_id: l.variant_id,
          quantity: l.quantity,
          discount_pct: 0,
          unit_price: l.unit_price,
        })),
        payments,
      };
      return createSale(body);
    },
    onSuccess: (sale) => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setPayOpen(false);
      Alert.alert(
        'Bill saved',
        `${sale.number} — total ${inr(sale.grand_total)}${
          Number(sale.balance_due) > 0 ? ` (due ${inr(sale.balance_due)})` : ''
        }`,
        [
          {
            text: 'View',
            onPress: () => {
              setLines([]);
              setNotes('');
              setCustomer(null);
              (navigation.getParent() as any)?.navigate('Sales', {
                screen: 'SaleDetail',
                params: { saleId: sale.id },
              });
            },
          },
          {
            text: 'Ring next',
            style: 'cancel',
            onPress: () => {
              setLines([]);
              setNotes('');
              setCustomer(null);
            },
          },
        ],
      );
    },
    onError: (err) => {
      Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
    },
  });

  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
      >
        <PageHeader
          title="New bill"
          description={activeStore ? `${activeStore.code} · ${activeStore.name}` : 'Loading store…'}
          actions={
            heldBills.length > 0 ? (
              <Pressable onPress={() => navigation.navigate('HeldBills')}>
                <Chip
                  label={`Held: ${heldBills.length}`}
                  tone="amber"
                  leadingIcon={<Clock size={12} color={colors.amber300} />}
                />
              </Pressable>
            ) : (
              <Chip
                label={sessionOpen ? 'Session open' : 'No session'}
                tone={sessionOpen ? 'emerald' : 'amber'}
              />
            )
          }
        />

        {!sessionOpen ? (
          <Pressable
            onPress={() => (navigation.getParent() as any)?.navigate('More', { screen: 'DaySession' })}
            style={styles.warnBanner}
          >
            <Text style={styles.warnText}>No open day session — tap to open one</Text>
            <Text style={styles.warnAction}>Open →</Text>
          </Pressable>
        ) : null}

        {/* Customer */}
        <Pressable onPress={() => setCustomerPickerOpen(true)}>
          <GlassCard padding={14}>
            <View style={styles.customerRow}>
              <View style={styles.customerIcon}>
                <User size={16} color={colors.slate300} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.customerName}>
                  {customer ? customer.name : 'Walk-in customer'}
                </Text>
                {customer?.phone ? (
                  <Text style={styles.customerSub}>{customer.phone}</Text>
                ) : (
                  <Text style={styles.customerSub}>Tap to attach a customer</Text>
                )}
              </View>
              <Text style={styles.customerAction}>{customer ? 'Change' : 'Pick'}</Text>
            </View>
          </GlassCard>
        </Pressable>

        {/* Search + scan */}
        <View style={styles.searchRow}>
          <View style={{ flex: 1 }}>
            <Input
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => query.trim() && addBySearchTerm(query.trim())}
              returnKeyType="search"
              placeholder="Scan or type SKU / name"
              autoCorrect={false}
              autoCapitalize="none"
              leadingIcon={<ScanBarcode size={16} color={colors.slate400} />}
            />
          </View>
          <Pressable onPress={() => setScannerOpen(true)} style={styles.scanBtn}>
            <ScanBarcode size={20} color={colors.white} />
          </Pressable>
        </View>

        {/* Search results */}
        {debounced.length > 0 ? (
          <GlassCard padding={0}>
            {summariesQuery.isLoading ? (
              <View style={{ padding: spacing[4] }}>
                <ActivityIndicator color={colors.cobalt300} />
              </View>
            ) : summaries.length === 0 ? (
              <Text style={styles.noMatch}>No product matches.</Text>
            ) : (
              summaries.slice(0, 6).map((p, i) => (
                <Pressable
                  key={p.id}
                  onPress={() => addBySummaryId(p.id)}
                  style={({ pressed }) => [
                    styles.searchResult,
                    i > 0 && styles.searchResultBorder,
                    pressed && styles.pressedRow,
                  ]}
                >
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.resultName} numberOfLines={1}>{p.name}</Text>
                    <Text style={styles.resultSub}>SKU {p.primary_sku ?? '—'}</Text>
                  </View>
                  <Text style={styles.resultPrice}>{inr(p.primary_selling_price)}</Text>
                </Pressable>
              ))
            )}
          </GlassCard>
        ) : null}

        {/* Cart */}
        <View>
          <Text style={styles.sectionLabel}>Bill items ({lines.length})</Text>
          {lines.length === 0 ? (
            <View style={styles.emptyCart}>
              <Text style={styles.emptyCartText}>
                Scan a barcode or search a product above.
              </Text>
            </View>
          ) : (
            <View style={{ gap: spacing[2] }}>
              {lines.map((item) => (
                <LineRow
                  key={item.variant_id}
                  line={item}
                  onBump={(d) => bump(item.variant_id, d)}
                  onRemove={() => bump(item.variant_id, -item.quantity)}
                />
              ))}
            </View>
          )}
        </View>

        {/* Notes */}
        <View>
          <Text style={styles.sectionLabel}>Notes (optional)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Any note printed / attached to this bill"
            placeholderTextColor={colors.slate500}
            multiline
            style={styles.notes}
          />
        </View>

        {/* Totals */}
        <GlassCard padding={16}>
          <TotalRow label="Subtotal (ex. GST)" value={inr(totals.subtotal)} />
          <TotalRow label="Tax (embedded)" value={inr(totals.tax)} muted />
          <View style={styles.divider} />
          <TotalRow label="Grand total" value={inr(totals.grand)} bold />
        </GlassCard>

        {/* Actions */}
        <View style={{ gap: spacing[2] }}>
          <Button
            label="Take payment & save"
            size="lg"
            onPress={() => setPayOpen(true)}
            disabled={lines.length === 0 || !sessionOpen || saveMutation.isPending}
          />
          <View style={{ flexDirection: 'row', gap: spacing[2] }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Hold bill"
                variant="secondary"
                onPress={onHold}
                disabled={lines.length === 0}
                leadingIcon={<Clock size={16} color={colors.slate200} />}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Clear cart"
                variant="ghost"
                onPress={() => {
                  if (lines.length === 0) return;
                  Alert.alert('Clear cart?', 'This removes every line without saving.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Clear',
                      style: 'destructive',
                      onPress: () => {
                        setLines([]);
                        setNotes('');
                        setCustomer(null);
                      },
                    },
                  ]);
                }}
              />
            </View>
          </View>
        </View>
      </ScrollView>

      <BarcodeScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={(code) => {
          setScannerOpen(false);
          void addBySearchTerm(code);
        }}
      />

      <CustomerPickerModal
        visible={customerPickerOpen}
        onClose={() => setCustomerPickerOpen(false)}
        onPick={(c) => {
          setCustomer(c);
          setCustomerPickerOpen(false);
        }}
      />

      <PaymentSheet
        visible={payOpen}
        grandTotal={totals.grand}
        loading={saveMutation.isPending}
        onClose={() => setPayOpen(false)}
        onConfirm={(payments) => saveMutation.mutate(payments)}
      />
    </View>
  );
}

function LineRow({
  line,
  onBump,
  onRemove,
}: {
  line: CartLine;
  onBump: (delta: number) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const lineTotal = (Number(line.unit_price) || 0) * line.quantity;
  return (
    <GlassCard padding={12}>
      <View style={styles.lineHead}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={styles.lineName} numberOfLines={1}>{line.product_name}</Text>
          <Text style={styles.lineSub}>SKU {line.sku} · {inr(line.unit_price)}/unit</Text>
        </View>
        <Text style={styles.linePrice}>{inr(lineTotal)}</Text>
      </View>

      <View style={styles.lineFoot}>
        <View style={styles.stepper}>
          <Stepper icon={<Minus size={16} color={colors.slate200} />} onPress={() => onBump(-1)} />
          <Text style={styles.qty}>{line.quantity}</Text>
          <Stepper icon={<Plus size={16} color={colors.slate200} />} onPress={() => onBump(1)} />
        </View>
        <Pressable onPress={onRemove} style={({ pressed }) => [styles.removeBtn, pressed && { backgroundColor: 'rgba(244,63,94,0.10)' }]}>
          <Trash2 size={14} color={colors.rose300} />
          <Text style={styles.removeText}>Remove</Text>
        </Pressable>
      </View>
    </GlassCard>
  );
}

function Stepper({ icon, onPress }: { icon: React.ReactNode; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.stepperBtn, pressed && { opacity: 0.6 }]}>
      {icon}
    </Pressable>
  );
}

function TotalRow({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.totalRow}>
      <Text
        style={[
          styles.totalLabel,
          bold && { color: colors.white, fontWeight: '600', fontSize: 14 },
          muted && { color: colors.slate400 },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.totalValue,
          bold && { color: colors.white, fontWeight: '700', fontSize: 18 },
          muted && { color: colors.slate400, fontWeight: '400' },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing[4],
    paddingBottom: spacing[8],
    gap: spacing[3],
  },
  warnBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.30)',
    backgroundColor: 'rgba(245,158,11,0.10)',
    borderRadius: radius.xl,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  warnText: { color: colors.amber200, fontSize: 12, flex: 1 },
  warnAction: { color: colors.amber200, fontSize: 12, fontWeight: '600' },

  customerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  customerIcon: {
    height: 36,
    width: 36,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  customerName: { color: colors.white, fontSize: 14, fontWeight: '500' },
  customerSub: { color: colors.slate400, fontSize: 11, marginTop: 1 },
  customerAction: { color: colors.cobalt300, fontSize: 12, fontWeight: '600' },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scanBtn: {
    height: 44,
    width: 44,
    borderRadius: radius.xl,
    backgroundColor: colors.cobalt600,
    justifyContent: 'center',
    alignItems: 'center',
  },

  noMatch: { padding: 16, color: colors.slate400, fontSize: 13 },
  searchResult: { paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  searchResultBorder: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' },
  pressedRow: { backgroundColor: 'rgba(255,255,255,0.06)' },
  resultName: { color: colors.white, fontSize: 13, fontWeight: '500' },
  resultSub: { color: colors.slate400, fontSize: 11, marginTop: 1 },
  resultPrice: { color: colors.cobalt200, fontSize: 13, fontWeight: '600' },

  sectionLabel: {
    color: colors.slate500,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  emptyCart: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: radius.xl,
    padding: 24,
  },
  emptyCartText: { color: colors.slate500, fontSize: 13, textAlign: 'center' },

  notes: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.white,
    fontSize: 14,
    textAlignVertical: 'top',
  },

  divider: { marginVertical: 8, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },

  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { color: colors.slate200, fontSize: 13 },
  totalValue: { color: colors.slate100, fontSize: 13, fontWeight: '500' },

  lineHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  lineName: { color: colors.white, fontSize: 13, fontWeight: '500' },
  lineSub: { color: colors.slate400, fontSize: 11, marginTop: 1 },
  linePrice: { color: colors.cobalt200, fontSize: 13, fontWeight: '600' },
  lineFoot: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperBtn: {
    height: 32,
    width: 32,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.04)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qty: { minWidth: 24, textAlign: 'center', color: colors.white, fontSize: 15, fontWeight: '600' },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  removeText: { color: colors.rose300, fontSize: 11, fontWeight: '600' },
});
