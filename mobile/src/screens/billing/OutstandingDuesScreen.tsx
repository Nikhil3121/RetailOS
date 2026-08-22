/**
 * OutstandingDuesScreen — every bill that still owes money.
 * Tap a row to open a modal that collects a payment against it.
 */

import type React from 'react';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IndianRupee, X } from 'lucide-react-native';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { collectSalePayment, listOutstanding } from '@/api/sales-api';
import { inr } from '@/lib/money';
import { PAYMENT_LABEL, type PaymentMethod, type SaleSummary } from '@/types/sale';

export function OutstandingDuesScreen(): React.JSX.Element {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['sales', 'outstanding'],
    queryFn: () => listOutstanding(1, 100),
  });

  const [target, setTarget] = useState<SaleSummary | null>(null);

  const totalDue = useMemo(
    () => (query.data?.items ?? []).reduce((s, x) => s + Number(x.balance_due || 0), 0),
    [query.data],
  );

  return (
    <SafeAreaView className="flex-1 bg-ink-950" edges={['top']}>
      <View className="px-4 pt-4">
        <Text className="text-2xl font-semibold text-white">Outstanding dues</Text>
        <Text className="mt-1 text-sm text-slate-400">
          {query.data?.items.length ?? 0} bill(s) · total {inr(totalDue)}
        </Text>
      </View>

      <FlatList
        data={query.data?.items ?? []}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setTarget(item)}
            className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2.5 active:bg-amber-500/[0.1]"
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-2">
                <Text className="text-sm font-medium text-white">{item.number}</Text>
                <Text className="mt-0.5 text-xs text-slate-400">
                  {new Date(item.created_at).toLocaleDateString('en-IN')} · {item.line_count} item{item.line_count === 1 ? '' : 's'}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-sm text-slate-400">Total {inr(item.grand_total)}</Text>
                <Text className="mt-0.5 text-base font-semibold text-amber-300">Due {inr(item.balance_due)}</Text>
              </View>
            </View>
          </Pressable>
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View className="h-2" />}
        refreshControl={
          <RefreshControl refreshing={query.isFetching} onRefresh={() => query.refetch()} tintColor="#5f8aff" />
        }
        ListEmptyComponent={
          query.isLoading ? (
            <ActivityIndicator color="#5f8aff" className="mt-16" />
          ) : (
            <EmptyState
              title="Everyone's paid up."
              hint="No bills currently carry a balance."
              icon={<IndianRupee size={32} color="#5f8aff" />}
            />
          )
        }
      />

      {target && (
        <CollectSheet
          bill={target}
          onClose={() => setTarget(null)}
          onCollected={() => {
            qc.invalidateQueries({ queryKey: ['sales'] });
            setTarget(null);
          }}
        />
      )}
    </SafeAreaView>
  );
}

function CollectSheet({
  bill,
  onClose,
  onCollected,
}: {
  bill: SaleSummary;
  onClose: () => void;
  onCollected: () => void;
}): React.JSX.Element {
  const [amount, setAmount] = useState(bill.balance_due);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');

  const collect = useMutation({
    mutationFn: () =>
      collectSalePayment(bill.id, {
        method,
        amount,
        reference: reference.trim() || null,
      }),
    onSuccess: () => {
      Alert.alert('Payment recorded', `Collected ${inr(amount)} against ${bill.number}.`);
      onCollected();
    },
    onError: (err) =>
      Alert.alert('Failed', err instanceof Error ? err.message : String(err)),
  });

  const invalid = Number(amount) <= 0 || Number(amount) > Number(bill.balance_due);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 justify-end bg-black/50">
        <View className="rounded-t-3xl border-t border-white/10 bg-ink-900 p-5">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-base font-semibold text-white">Collect against {bill.number}</Text>
            <Pressable onPress={onClose} className="rounded-full bg-white/10 p-1.5 active:bg-white/20">
              <X size={16} color="#fff" />
            </Pressable>
          </View>

          <View className="mb-3 flex-row justify-between rounded-xl bg-white/[0.04] p-3">
            <Text className="text-sm text-slate-400">Balance due</Text>
            <Text className="text-base font-semibold text-amber-300">{inr(bill.balance_due)}</Text>
          </View>

          <Text className="mb-1 text-xs uppercase tracking-wider text-slate-500">Method</Text>
          <View className="mb-3 flex-row flex-wrap gap-2">
            {(['cash', 'upi', 'card', 'other'] as PaymentMethod[]).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMethod(m)}
                className={`rounded-xl px-4 py-2 ${
                  method === m ? 'bg-cobalt-600' : 'border border-white/10 bg-white/[0.04]'
                }`}
              >
                <Text className={`text-sm font-medium ${method === m ? 'text-white' : 'text-slate-200'}`}>
                  {PAYMENT_LABEL[m]}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text className="mb-1 text-xs uppercase tracking-wider text-slate-500">Amount</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-base text-white"
          />

          {method !== 'cash' && (
            <>
              <Text className="mt-3 mb-1 text-xs uppercase tracking-wider text-slate-500">
                Reference (transaction id / last 4 digits)
              </Text>
              <TextInput
                value={reference}
                onChangeText={setReference}
                placeholder="Optional"
                placeholderTextColor="#4b5563"
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-base text-white"
              />
            </>
          )}

          <View className="mt-4">
            <Button
              label={collect.isPending ? 'Recording…' : 'Record payment'}
              onPress={() => collect.mutate()}
              disabled={invalid || collect.isPending}
              loading={collect.isPending}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
