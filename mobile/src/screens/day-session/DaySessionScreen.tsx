/**
 * DaySessionScreen — open / close a shift on the phone.
 *
 * Same three modes as the desktop page:
 *   1. No open session → show an "Open session" form (opening cash)
 *   2. Session already open → show current metrics + a "Close" form
 *   3. Just closed → confirmation with cash reconciliation
 */

import type React from 'react';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorClosed, DoorOpen } from 'lucide-react-native';

import { Button } from '@/components/Button';
import { listStores } from '@/api/catalog-api';
import {
  closeSession,
  currentSession,
  openSession,
  sessionSummary,
  type DaySession,
} from '@/api/day-sessions-api';
import { inr } from '@/lib/money';
import { useAuthStore } from '@/stores/auth-store';

export function DaySessionScreen(): React.JSX.Element {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const stores = storesQuery.data?.items ?? [];
  const [storeId, setStoreId] = useState<string>(user?.store_id ?? '');
  // Default to first store once loaded and none picked.
  useMemo(() => {
    if (!storeId && stores.length > 0) setStoreId(stores[0].id);
  }, [stores, storeId]);

  const sessionProbes = useQueries({
    queries: stores.map((s) => ({
      queryKey: ['day-session', 'current', s.id],
      queryFn: () => currentSession(s.id),
      staleTime: 0,
    })),
  });

  const activeStore = stores.find((s) => s.id === storeId);
  const currentIndex = stores.findIndex((s) => s.id === storeId);
  const openSess: DaySession | null =
    currentIndex >= 0
      ? sessionProbes[currentIndex]?.data && sessionProbes[currentIndex].data!.status === 'open'
        ? sessionProbes[currentIndex].data ?? null
        : null
      : null;

  const summary = useQuery({
    queryKey: ['day-session', 'summary', openSess?.id],
    queryFn: () => sessionSummary(openSess!.id),
    enabled: !!openSess?.id,
  });

  const [openingCash, setOpeningCash] = useState('');
  const [countedCash, setCountedCash] = useState('');

  const openMutation = useMutation({
    mutationFn: () =>
      openSession({ store_id: storeId, opening_cash: openingCash || '0' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['day-session'] });
      setOpeningCash('');
      Alert.alert('Session opened', 'The counter is now live for billing.');
    },
    onError: (err) =>
      Alert.alert('Failed to open', err instanceof Error ? err.message : String(err)),
  });

  const closeMutation = useMutation({
    mutationFn: () => closeSession(openSess!.id, { counted_cash: countedCash || '0' }),
    onSuccess: (closed) => {
      qc.invalidateQueries({ queryKey: ['day-session'] });
      setCountedCash('');
      const diff = Number(closed.cash_diff ?? 0);
      const msg =
        diff === 0
          ? 'Cash matched the expected amount exactly.'
          : diff > 0
            ? `Cash over by ${inr(diff)}.`
            : `Cash short by ${inr(-diff)}.`;
      Alert.alert('Session closed', msg);
    },
    onError: (err) =>
      Alert.alert('Failed to close', err instanceof Error ? err.message : String(err)),
  });

  return (
    <SafeAreaView className="flex-1 bg-ink-950" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Text className="text-2xl font-semibold text-white">Day session</Text>
        <Text className="mt-1 text-sm text-slate-400">
          Open a shift with your opening cash, close it later to reconcile.
        </Text>

        <View className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <Text className="text-xs uppercase tracking-wider text-slate-500">Store</Text>
          {storesQuery.isLoading ? (
            <ActivityIndicator color="#5f8aff" className="mt-3" />
          ) : (
            <View className="mt-2 flex-row flex-wrap gap-2">
              {stores.map((s) => (
                <Button
                  key={s.id}
                  label={`${s.code} · ${s.name}`}
                  variant={s.id === storeId ? 'primary' : 'secondary'}
                  onPress={() => setStoreId(s.id)}
                />
              ))}
            </View>
          )}
        </View>

        {openSess ? (
          <View className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <View className="flex-row items-center gap-2">
              <DoorOpen size={16} color="#6ee7b7" />
              <Text className="text-sm font-semibold text-emerald-200">Session is open</Text>
            </View>
            <Text className="mt-1 text-xs text-slate-300">
              Opened {new Date(openSess.opened_at).toLocaleString('en-IN')}
            </Text>
            <View className="mt-3">
              <Row label="Opening cash" value={inr(openSess.opening_cash)} />
              {summary.data && (
                <>
                  <Row label="Bills today" value={String(summary.data.sales_count)} />
                  <Row label="Sales total" value={inr(summary.data.sales_total)} />
                  <Row label="Cash sales" value={inr(summary.data.cash_sales_total)} />
                  <Row label="UPI sales" value={inr(summary.data.upi_sales_total)} />
                  <Row label="Card sales" value={inr(summary.data.card_sales_total)} />
                  <View className="my-2 h-px bg-white/10" />
                  <Row label="Expected cash" value={inr(summary.data.expected_cash)} bold />
                </>
              )}
            </View>

            <View className="mt-4">
              <Text className="mb-1 text-xs uppercase tracking-wider text-slate-500">Counted cash</Text>
              <TextInput
                value={countedCash}
                onChangeText={setCountedCash}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#4b5563"
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-base text-white"
              />
            </View>
            <View className="mt-3">
              <Button
                label={closeMutation.isPending ? 'Closing…' : 'Close session'}
                variant="danger"
                loading={closeMutation.isPending}
                onPress={() => closeMutation.mutate()}
                leadingIcon={<DoorClosed size={16} color="#fff" />}
              />
            </View>
          </View>
        ) : (
          <View className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <View className="flex-row items-center gap-2">
              <DoorClosed size={16} color="#fbbf24" />
              <Text className="text-sm font-semibold text-amber-200">No open session</Text>
            </View>
            <Text className="mt-1 text-xs text-slate-400">
              {activeStore ? `Open the counter for ${activeStore.code} · ${activeStore.name}.` : 'Pick a store above.'}
            </Text>

            <View className="mt-4">
              <Text className="mb-1 text-xs uppercase tracking-wider text-slate-500">
                Opening cash (in drawer)
              </Text>
              <TextInput
                value={openingCash}
                onChangeText={setOpeningCash}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#4b5563"
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-base text-white"
              />
            </View>
            <View className="mt-3">
              <Button
                label={openMutation.isPending ? 'Opening…' : 'Open session'}
                loading={openMutation.isPending}
                disabled={!storeId}
                onPress={() => openMutation.mutate()}
                leadingIcon={<DoorOpen size={16} color="#fff" />}
              />
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }): React.JSX.Element {
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className={bold ? 'text-sm font-semibold text-white' : 'text-xs text-slate-400'}>
        {label}
      </Text>
      <Text className={bold ? 'text-base font-semibold text-white' : 'text-sm text-slate-100'}>
        {value}
      </Text>
    </View>
  );
}
