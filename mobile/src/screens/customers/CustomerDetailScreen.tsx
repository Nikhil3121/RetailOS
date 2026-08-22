import type React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import { getCustomer } from '@/api/customers-api';
import type { CustomersStackParamList } from '@/navigation/stacks/CustomersStack';

export function CustomerDetailScreen(): React.JSX.Element {
  const route = useRoute<RouteProp<CustomersStackParamList, 'CustomerDetail'>>();
  const q = useQuery({
    queryKey: ['customer', route.params.customerId],
    queryFn: () => getCustomer(route.params.customerId),
  });
  const c = q.data;

  if (q.isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-ink-950">
        <ActivityIndicator color="#5f8aff" />
      </SafeAreaView>
    );
  }
  if (!c) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-ink-950 p-6">
        <Text className="text-center text-slate-300">Customer not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-ink-950" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Text className="text-2xl font-semibold text-white">{c.name}</Text>
        {!c.is_active && <Text className="mt-1 text-xs text-amber-300">Inactive</Text>}

        <View className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <KV k="Phone" v={c.phone ?? '—'} />
          <KV k="Email" v={c.email ?? '—'} />
          <KV k="GSTIN" v={c.gstin ?? '—'} />
          <KV k="Company" v={c.company_name ?? '—'} />
          <KV k="City / State" v={[c.city, c.state].filter(Boolean).join(', ') || '—'} />
          <KV k="Country" v={c.country} />
          <KV k="Date of birth" v={c.date_of_birth ?? '—'} />
          <KV k="Anniversary" v={c.anniversary ?? '—'} />
        </View>

        {c.notes && (
          <View className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <Text className="mb-1 text-xs uppercase tracking-wider text-slate-500">Notes</Text>
            <Text className="text-sm text-slate-200">{c.notes}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function KV({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className="text-xs text-slate-500">{k}</Text>
      <Text className="max-w-[60%] text-right text-sm text-slate-100" numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}
