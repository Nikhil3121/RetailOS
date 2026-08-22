import type React from 'react';
import { useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react-native';

import { useDebounce } from '@/hooks/useDebounce';
import { listCustomers } from '@/api/customers-api';
import type { Customer } from '@/types/customer';

interface CustomerPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onPick: (customer: Customer | null) => void;
}

export function CustomerPickerModal({
  visible,
  onClose,
  onPick,
}: CustomerPickerModalProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query.trim(), 250);

  const q = useQuery({
    queryKey: ['customers', 'picker', debounced],
    queryFn: () => listCustomers(1, 50, debounced || undefined),
    enabled: visible,
    placeholderData: (prev) => prev,
  });

  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide" statusBarTranslucent>
      <View className="flex-1 bg-ink-950">
        <View className="flex-row items-center justify-between px-4 pt-14 pb-3">
          <Text className="text-base font-semibold text-white">Pick a customer</Text>
          <Pressable onPress={onClose} className="rounded-full bg-white/10 p-2 active:bg-white/20">
            <X size={18} color="#fff" />
          </Pressable>
        </View>
        <View className="mx-4 mb-2 flex-row items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
          <Search size={16} color="#94a3b8" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or phone"
            placeholderTextColor="#4b5563"
            autoFocus
            className="flex-1 text-base text-white"
          />
        </View>

        <Pressable
          onPress={() => onPick(null)}
          className="mx-4 mb-2 rounded-xl border border-dashed border-white/20 p-3 active:bg-white/[0.04]"
        >
          <Text className="text-center text-sm text-slate-300">— Walk-in (no customer) —</Text>
        </Pressable>

        <FlatList
          data={q.data?.items ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          ItemSeparatorComponent={() => <View className="h-1.5" />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onPick(item)}
              className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 active:bg-white/[0.08]"
            >
              <Text className="text-sm font-medium text-white">{item.name}</Text>
              <Text className="text-xs text-slate-400">
                {item.phone ?? 'no phone'}
                {item.gstin ? ` · GSTIN ${item.gstin}` : ''}
              </Text>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}
