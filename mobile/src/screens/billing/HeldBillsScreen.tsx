/**
 * HeldBillsScreen — shows every parked bill and lets the operator resume
 * or discard each. Reached from the Bill tab via a stack push.
 */

import type React from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Clock, RotateCcw, Trash2 } from 'lucide-react-native';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { inr } from '@/lib/money';
import { useHeldBillsStore } from '@/stores/held-bills-store';
import type { BillingStackParamList } from '@/navigation/stacks/BillingStack';

function ago(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function HeldBillsScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<BillingStackParamList>>();
  const bills = useHeldBillsStore((s) => s.bills);
  const discard = useHeldBillsStore((s) => s.discard);
  const clearAll = useHeldBillsStore((s) => s.clear);

  return (
    <SafeAreaView className="flex-1 bg-ink-950" edges={['top']}>
      <View className="px-4 pt-4">
        <Text className="text-2xl font-semibold text-white">Held bills</Text>
        <Text className="mt-1 text-sm text-slate-400">
          {bills.length} on hold — tap Resume to load a bill back onto the counter.
        </Text>
      </View>

      <FlatList
        data={[...bills].reverse()}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View className="h-2" />}
        renderItem={({ item }) => {
          const total = item.lines.reduce(
            (sum, l) => sum + (Number(l.unit_price) || 0) * l.quantity,
            0,
          );
          return (
            <View className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-2">
                  <Text className="text-sm font-medium text-white">
                    {item.lines.length} item{item.lines.length === 1 ? '' : 's'}
                  </Text>
                  <View className="mt-0.5 flex-row items-center gap-1">
                    <Clock size={11} color="#94a3b8" />
                    <Text className="text-xs text-slate-400">{ago(item.held_at)}</Text>
                  </View>
                  {item.notes ? (
                    <Text className="mt-1 text-xs italic text-slate-500" numberOfLines={1}>
                      {item.notes}
                    </Text>
                  ) : null}
                </View>
                <Text className="text-sm font-semibold text-cobalt-200">{inr(total)}</Text>
              </View>
              <View className="mt-3 flex-row gap-2">
                <View className="flex-1">
                  <Button
                    label="Resume"
                    variant="secondary"
                    leadingIcon={<RotateCcw size={16} color="#e2e8f0" />}
                    onPress={() => navigation.navigate('NewBill', { resumeHeldId: item.id })}
                  />
                </View>
                <Pressable
                  onPress={() =>
                    Alert.alert('Discard bill?', 'This held bill will be permanently removed.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Discard', style: 'destructive', onPress: () => discard(item.id) },
                    ])
                  }
                  className="h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] active:bg-rose-500/10"
                >
                  <Trash2 size={16} color="#fda4af" />
                </Pressable>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            title="No held bills."
            hint="On the New Bill screen, tap Hold to park the current cart and serve another customer."
            icon={<Clock size={32} color="#5f8aff" />}
          />
        }
        ListFooterComponent={
          bills.length > 0 ? (
            <View className="mt-4">
              <Button
                label="Clear all held bills"
                variant="ghost"
                onPress={() =>
                  Alert.alert('Clear all?', 'This removes every held bill on this device.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Clear', style: 'destructive', onPress: clearAll },
                  ])
                }
              />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
