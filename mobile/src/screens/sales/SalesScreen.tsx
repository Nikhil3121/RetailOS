/**
 * SalesScreen — today's bills. Read-only for the pilot; groups today vs earlier.
 */

import type React from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react-native';

import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { listSales } from '@/api/sales-api';
import { inr } from '@/lib/money';
import { colors, radius, spacing } from '@/constants/theme';
import type { SaleSummary } from '@/types/sale';
import type { SalesStackParamList } from '@/navigation/stacks/SalesStack';

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function SalesScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<SalesStackParamList>>();
  const salesQuery = useQuery({
    queryKey: ['sales', 'mobile-recent'],
    queryFn: () => listSales({ page_size: 50 }),
  });

  const all = salesQuery.data?.items ?? [];
  const today = all.filter((s) => isToday(s.created_at));
  const earlier = all.filter((s) => !isToday(s.created_at));
  const totalToday = today.reduce((sum, s) => sum + Number(s.grand_total || 0), 0);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: spacing[4] }}>
        <PageHeader title="Sales" description={`${today.length} today · ${inr(totalToday)}`} />
      </View>

      <FlatList
        data={[...today, ...earlier]}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('SaleDetail', { saleId: item.id })}>
            <Row item={item} highlight={isToday(item.created_at)} />
          </Pressable>
        )}
        contentContainerStyle={{ paddingHorizontal: spacing[4], paddingBottom: spacing[6] }}
        ItemSeparatorComponent={() => <View style={{ height: spacing[2] }} />}
        refreshControl={
          <RefreshControl
            refreshing={salesQuery.isFetching}
            onRefresh={() => salesQuery.refetch()}
            tintColor={colors.cobalt300}
          />
        }
        ListEmptyComponent={
          salesQuery.isLoading ? (
            <View style={{ marginTop: spacing[8], alignItems: 'center' }}>
              <ActivityIndicator color={colors.cobalt300} />
            </View>
          ) : (
            <EmptyState
              title="No sales yet."
              hint="Ring up your first bill from the New Bill tab."
              icon={<Receipt size={32} color={colors.cobalt300} />}
            />
          )
        }
      />
    </View>
  );
}

function Row({ item, highlight }: { item: SaleSummary; highlight: boolean }): React.JSX.Element {
  const due = Number(item.balance_due) || 0;
  return (
    <View
      style={[
        rowStyles.row,
        highlight
          ? { borderColor: 'rgba(31,71,240,0.30)', backgroundColor: 'rgba(31,71,240,0.05)' }
          : { borderColor: colors.border, backgroundColor: colors.surface },
      ]}
    >
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Text style={rowStyles.number}>{item.number}</Text>
        <Text style={rowStyles.sub}>
          {formatTime(item.created_at)} · {item.line_count} item{item.line_count === 1 ? '' : 's'}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={rowStyles.total}>{inr(item.grand_total)}</Text>
        {due > 0 ? <Text style={rowStyles.due}>Due {inr(due)}</Text> : null}
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  number: { color: colors.white, fontSize: 13, fontWeight: '500' },
  sub: { color: colors.slate400, fontSize: 11, marginTop: 2 },
  total: { color: colors.white, fontSize: 15, fontWeight: '600' },
  due: { color: colors.amber300, fontSize: 10, fontWeight: '600', marginTop: 2 },
});
