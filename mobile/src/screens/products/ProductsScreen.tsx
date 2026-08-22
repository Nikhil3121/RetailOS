/**
 * ProductsScreen — server-searched product list.
 *
 * Debounced (250ms) input hits GET /products?search=… on Render, which
 * matches product name, HSN, variant SKU, and barcode. Same endpoint as
 * desktop's Products page. Pagination stops at 30 to keep the list
 * scannable on a phone.
 */

import type React from 'react';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Package, Search } from 'lucide-react-native';

import { EmptyState } from '@/components/EmptyState';
import { GlassCard } from '@/components/GlassCard';
import { Input } from '@/components/Input';
import { PageHeader } from '@/components/PageHeader';
import { useDebounce } from '@/hooks/useDebounce';
import { listProducts } from '@/api/catalog-api';
import { inr } from '@/lib/money';
import { colors, spacing } from '@/constants/theme';
import type { ProductSummary } from '@/types/product';
import type { ProductsStackParamList } from '@/navigation/stacks/ProductsStack';

export function ProductsScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<ProductsStackParamList>>();
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query.trim(), 250);

  const productsQuery = useQuery({
    queryKey: ['products', 'mobile', debounced],
    queryFn: () =>
      listProducts({
        page_size: 30,
        is_active: true,
        search: debounced || undefined,
      }),
    placeholderData: (prev) => prev,
  });

  const items = productsQuery.data?.items ?? [];
  const total = productsQuery.data?.total ?? 0;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: spacing[4], gap: spacing[3] }}>
        <PageHeader
          title="Products"
          description={total > 0 ? `${total.toLocaleString('en-IN')} matching` : 'Search the catalog'}
        />
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name, SKU, barcode, or HSN"
          autoCorrect={false}
          autoCapitalize="none"
          leadingIcon={<Search size={16} color={colors.slate400} />}
        />
      </View>

      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}>
            <Row item={item} />
          </Pressable>
        )}
        contentContainerStyle={{ paddingHorizontal: spacing[4], paddingBottom: spacing[6] }}
        ItemSeparatorComponent={() => <View style={{ height: spacing[2] }} />}
        refreshControl={
          <RefreshControl
            refreshing={productsQuery.isFetching && !productsQuery.isPlaceholderData}
            onRefresh={() => productsQuery.refetch()}
            tintColor={colors.cobalt300}
          />
        }
        ListEmptyComponent={
          productsQuery.isLoading ? (
            <View style={{ marginTop: spacing[8], alignItems: 'center' }}>
              <ActivityIndicator color={colors.cobalt300} />
            </View>
          ) : (
            <EmptyState
              title={debounced ? 'No products match that search.' : 'Type to search products'}
              hint={debounced ? 'Try a shorter substring, SKU, or barcode.' : undefined}
              icon={<Package size={32} color={colors.cobalt300} />}
            />
          )
        }
      />
    </View>
  );
}

function Row({ item }: { item: ProductSummary }): React.JSX.Element {
  const priceInclusive = inr(item.primary_selling_price);
  return (
    <GlassCard padding={14}>
      <View style={rowStyles.row}>
        <View style={{ flex: 1 }}>
          <Text style={rowStyles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={rowStyles.sub}>
            SKU {item.primary_sku ?? '—'}
            {item.hsn_code ? ` · HSN ${item.hsn_code}` : ''}
            {Number(item.tax_rate) > 0 ? ` · GST ${Number(item.tax_rate)}%` : ''}
          </Text>
        </View>
        <Text style={rowStyles.price}>{priceInclusive}</Text>
      </View>
    </GlassCard>
  );
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  name: { color: colors.white, fontSize: 15, fontWeight: '500' },
  sub: { color: colors.slate400, fontSize: 11, marginTop: 2 },
  price: { color: colors.cobalt200, fontSize: 15, fontWeight: '600' },
});
