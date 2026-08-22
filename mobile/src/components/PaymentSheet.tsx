/**
 * PaymentSheet — bottom modal that collects payment splits (cash + UPI +
 * card + other) against a grand_total. Supports partial payments — any
 * shortfall becomes balance_due on the resulting sale.
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { X } from 'lucide-react-native';

import { Button } from '@/components/Button';
import { inr, round2 } from '@/lib/money';
import { PAYMENT_LABEL, type PaymentMethod, type SalePaymentInput } from '@/types/sale';

interface PaymentSheetProps {
  visible: boolean;
  grandTotal: number;
  onClose: () => void;
  onConfirm: (payments: SalePaymentInput[]) => void;
  loading?: boolean;
}

type Row = { method: PaymentMethod; amount: string; reference: string };

export function PaymentSheet({
  visible,
  grandTotal,
  onClose,
  onConfirm,
  loading,
}: PaymentSheetProps): React.JSX.Element {
  const [rows, setRows] = useState<Row[]>([]);

  // Reset each time the sheet opens: one row pre-filled with the full total in cash.
  useEffect(() => {
    if (visible) {
      setRows([{ method: 'cash', amount: grandTotal.toFixed(2), reference: '' }]);
    }
  }, [visible, grandTotal]);

  const paid = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const remaining = round2(grandTotal - paid);
  const isDue = remaining > 0;
  const isChange = remaining < 0;

  function updateRow(i: number, patch: Partial<Row>): void {
    setRows((cur) => cur.map((r, ix) => (ix === i ? { ...r, ...patch } : r)));
  }
  function addRow(): void {
    setRows((cur) => [...cur, { method: 'upi', amount: Math.max(0, remaining).toFixed(2), reference: '' }]);
  }
  function removeRow(i: number): void {
    setRows((cur) => cur.filter((_, ix) => ix !== i));
  }

  function submit(): void {
    onConfirm(
      rows
        .filter((r) => Number(r.amount) > 0)
        .map<SalePaymentInput>((r) => ({
          method: r.method,
          amount: r.amount,
          reference: r.reference.trim() || null,
        })),
    );
  }

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 justify-end bg-black/50">
        <View className="max-h-[85%] rounded-t-3xl border-t border-white/10 bg-ink-900 p-5">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-base font-semibold text-white">Payment</Text>
            <Pressable onPress={onClose} className="rounded-full bg-white/10 p-1.5 active:bg-white/20">
              <X size={16} color="#fff" />
            </Pressable>
          </View>

          <View className="mb-3 rounded-xl bg-white/[0.04] p-3">
            <View className="flex-row justify-between">
              <Text className="text-sm text-slate-400">Grand total</Text>
              <Text className="text-lg font-semibold text-white">{inr(grandTotal)}</Text>
            </View>
            <View className="mt-1 flex-row justify-between">
              <Text className="text-xs text-slate-400">{isDue ? 'Balance due' : isChange ? 'Change owed' : 'Paid in full'}</Text>
              <Text className={`text-sm font-semibold ${isDue ? 'text-amber-300' : isChange ? 'text-emerald-300' : 'text-emerald-300'}`}>
                {isDue ? inr(remaining) : isChange ? inr(-remaining) : inr(0)}
              </Text>
            </View>
          </View>

          <ScrollView className="max-h-80">
            {rows.map((r, i) => (
              <View key={i} className="mb-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <View className="flex-row flex-wrap gap-1.5">
                  {(['cash', 'upi', 'card', 'other'] as PaymentMethod[]).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => updateRow(i, { method: m })}
                      className={`rounded-lg px-3 py-1.5 ${
                        r.method === m ? 'bg-cobalt-600' : 'border border-white/10 bg-white/[0.04]'
                      }`}
                    >
                      <Text className={`text-xs font-medium ${r.method === m ? 'text-white' : 'text-slate-200'}`}>
                        {PAYMENT_LABEL[m]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View className="mt-2 flex-row items-center gap-2">
                  <TextInput
                    value={r.amount}
                    onChangeText={(v) => updateRow(i, { amount: v })}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="#4b5563"
                    className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-base text-white"
                  />
                  {rows.length > 1 && (
                    <Pressable
                      onPress={() => removeRow(i)}
                      className="rounded-lg border border-rose-500/30 px-3 py-2 active:bg-rose-500/10"
                    >
                      <Text className="text-xs font-medium text-rose-300">Remove</Text>
                    </Pressable>
                  )}
                </View>
                {r.method !== 'cash' && (
                  <TextInput
                    value={r.reference}
                    onChangeText={(v) => updateRow(i, { reference: v })}
                    placeholder="Reference / txn id (optional)"
                    placeholderTextColor="#4b5563"
                    className="mt-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white"
                  />
                )}
              </View>
            ))}
          </ScrollView>

          <View className="mt-1 flex-row gap-2">
            <View className="flex-1">
              <Button label="+ Split payment" variant="secondary" onPress={addRow} />
            </View>
          </View>

          <View className="mt-3">
            <Button
              label={loading ? 'Saving…' : isDue ? `Save with ₹${remaining.toFixed(2)} due` : 'Save bill'}
              loading={loading}
              disabled={paid <= 0}
              onPress={submit}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
