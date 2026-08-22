/**
 * ProductDetailScreen — the variants + pricing view for one product.
 * Reached from the Products list. No editing yet (mobile is pilot-only —
 * catalog CRUD stays on desktop).
 */

import type React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react-native';

import { Button } from '@/components/Button';
import { getProduct } from '@/api/catalog-api';
import { inr } from '@/lib/money';
import type { ProductsStackParamList } from '@/navigation/stacks/ProductsStack';

export function ProductDetailScreen(): React.JSX.Element {
  const route = useRoute<RouteProp<ProductsStackParamList, 'ProductDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<ProductsStackParamList>>();
  const { productId } = route.params;

  const productQuery = useQuery({
    queryKey: ['product', productId],
    queryFn: () => getProduct(productId),
  });

  const p = productQuery.data;

  if (productQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-ink-950">
        <ActivityIndicator color="#5f8aff" />
      </SafeAreaView>
    );
  }
  if (!p) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-ink-950 p-6">
        <Text className="text-center text-slate-300">Product not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-ink-950" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Text className="text-2xl font-semibold text-white">{p.name}</Text>
        <Text className="mt-1 text-sm text-slate-400">
          {p.hsn_code ? `HSN ${p.hsn_code}` : 'HSN not set'}
          {Number(p.tax_rate) > 0 ? ` · GST ${Number(p.tax_rate)}%` : ' · GST 0%'}
          {!p.is_active ? ' · INACTIVE' : ''}
        </Text>
        {p.description && (
          <Text className="mt-2 text-sm text-slate-300">{p.description}</Text>
        )}

        <View className="mt-5">
          <Text className="mb-2 text-xs uppercase tracking-wider text-slate-500">
            Variants ({p.variants.length})
          </Text>

          {p.variants.map((v) => (
            <View
              key={v.id}
              className="mb-2 rounded-xl border border-white/10 bg-white/[0.04] p-3"
            >
              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-2">
                  <Text className="text-sm font-medium text-white">{v.name}</Text>
                  <Text className="mt-0.5 text-xs text-slate-400">
                    SKU {v.sku}
                    {v.barcode ? ` · barcode ${v.barcode}` : ''}
                    {!v.is_active ? ' · inactive' : ''}
                  </Text>
                  <View className="mt-2 flex-row flex-wrap gap-x-4 gap-y-1">
                    <KV k="Cost" v={inr(v.cost_price)} />
                    <KV k="MRP" v={inr(v.mrp)} />
                    <KV k="Selling" v={inr(v.selling_price)} />
                  </View>
                  {Object.keys(v.attributes ?? {}).length > 0 && (
                    <View className="mt-2 flex-row flex-wrap gap-2">
                      {Object.entries(v.attributes as Record<string, unknown>).map(([k, val]) => (
                        <View key={k} className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5">
                          <Text className="text-[10px] text-slate-300">
                            {k}: {String(val)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                <Text className="text-base font-semibold text-cobalt-200">{inr(v.selling_price)}</Text>
              </View>
            </View>
          ))}
        </View>

        <View className="mt-4">
          <Button
            label="Back to catalog"
            variant="secondary"
            leadingIcon={<ShoppingCart size={16} color="#e2e8f0" />}
            onPress={() => navigation.goBack()}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function KV({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <View>
      <Text className="text-[10px] uppercase tracking-wider text-slate-500">{k}</Text>
      <Text className="text-sm text-slate-100">{v}</Text>
    </View>
  );
}
