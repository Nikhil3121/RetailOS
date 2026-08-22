import type React from 'react';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Phone, Plus, Search, UserPlus } from 'lucide-react-native';

import { EmptyState } from '@/components/EmptyState';
import { GlassCard } from '@/components/GlassCard';
import { Input } from '@/components/Input';
import { PageHeader } from '@/components/PageHeader';
import { useDebounce } from '@/hooks/useDebounce';
import { listCustomers } from '@/api/customers-api';
import { colors, radius, spacing } from '@/constants/theme';
import type { CustomersStackParamList } from '@/navigation/stacks/CustomersStack';

export function CustomersScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<CustomersStackParamList>>();
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query.trim(), 250);

  const customersQuery = useQuery({
    queryKey: ['customers', 'mobile', debounced],
    queryFn: () => listCustomers(1, 100, debounced || undefined),
    placeholderData: (prev) => prev,
  });
  const items = customersQuery.data?.items ?? [];
  const total = customersQuery.data?.total ?? 0;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: spacing[4], gap: spacing[3] }}>
        <PageHeader
          title="Customers"
          description={`${total.toLocaleString('en-IN')} in the directory`}
          actions={
            <Pressable onPress={() => navigation.navigate('NewCustomer')} style={styles.addBtn}>
              <Plus size={16} color={colors.white} />
              <Text style={styles.addBtnText}>Add</Text>
            </Pressable>
          }
        />
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name or phone"
          autoCorrect={false}
          leadingIcon={<Search size={16} color={colors.slate400} />}
        />
      </View>

      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('CustomerDetail', { customerId: item.id })}>
            <GlassCard padding={14}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              <View style={styles.subRow}>
                <Phone size={11} color={colors.slate400} />
                <Text style={styles.sub}>
                  {item.phone ?? 'no phone'}{item.gstin ? ` · GSTIN ${item.gstin}` : ''}
                </Text>
              </View>
            </GlassCard>
          </Pressable>
        )}
        contentContainerStyle={{ paddingHorizontal: spacing[4], paddingBottom: spacing[6] }}
        ItemSeparatorComponent={() => <View style={{ height: spacing[2] }} />}
        refreshControl={
          <RefreshControl
            refreshing={customersQuery.isFetching && !customersQuery.isPlaceholderData}
            onRefresh={() => customersQuery.refetch()}
            tintColor={colors.cobalt300}
          />
        }
        ListEmptyComponent={
          customersQuery.isLoading ? (
            <ActivityIndicator color={colors.cobalt300} style={{ marginTop: spacing[8] }} />
          ) : (
            <EmptyState
              title="No customers match."
              hint="Add a new customer with the button in the header."
              icon={<UserPlus size={32} color={colors.cobalt300} />}
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.cobalt600,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.xl,
  },
  addBtnText: { color: colors.white, fontSize: 13, fontWeight: '600' },
  name: { color: colors.white, fontSize: 14, fontWeight: '500' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  sub: { color: colors.slate400, fontSize: 11 },
});
