import type React from 'react';
import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/Button';
import { createCustomer } from '@/api/customers-api';

export function NewCustomerScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gstin, setGstin] = useState('');
  const [city, setCity] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      createCustomer({
        name: name.trim(),
        phone: phone.trim() || null,
        gstin: gstin.trim() || null,
        city: city.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      Alert.alert('Customer added', `${name.trim()} is in the directory.`);
      navigation.goBack();
    },
    onError: (err) =>
      Alert.alert('Add failed', err instanceof Error ? err.message : String(err)),
  });

  const canSave = name.trim().length > 0 && !createMutation.isPending;

  return (
    <SafeAreaView className="flex-1 bg-ink-950" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <Text className="text-2xl font-semibold text-white">Add customer</Text>
        <Text className="mt-1 text-sm text-slate-400">Name is required; everything else is optional.</Text>

        <Field label="Name" value={name} onChangeText={setName} placeholder="Full name" autoCap="words" />
        <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="9812345678" keyboardType="phone-pad" />
        <Field label="GSTIN (optional)" value={gstin} onChangeText={setGstin} placeholder="22ABCDE1234F1Z5" autoCap="characters" />
        <Field label="City" value={city} onChangeText={setCity} placeholder="Madanpur" autoCap="words" />

        <View className="mt-5 gap-2">
          <Button
            label={createMutation.isPending ? 'Saving…' : 'Save customer'}
            onPress={() => createMutation.mutate()}
            disabled={!canSave}
            loading={createMutation.isPending}
          />
          <Button label="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCap = 'none',
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'email-address' | 'decimal-pad';
  autoCap?: 'none' | 'words' | 'characters' | 'sentences';
}): React.JSX.Element {
  return (
    <View className="mt-4">
      <Text className="mb-1 text-xs uppercase tracking-wider text-slate-500">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#4b5563"
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCap}
        autoCorrect={false}
        className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-base text-white"
      />
    </View>
  );
}
