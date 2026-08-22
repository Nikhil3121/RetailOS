import type React from 'react';
import { Text, View } from 'react-native';

interface EmptyStateProps {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
}

export function EmptyState({ title, hint, icon }: EmptyStateProps): React.JSX.Element {
  return (
    <View className="flex-1 items-center justify-center px-8">
      {icon && <View className="mb-4 opacity-60">{icon}</View>}
      <Text className="text-base font-medium text-slate-200">{title}</Text>
      {hint && <Text className="mt-2 text-center text-sm text-slate-400">{hint}</Text>}
    </View>
  );
}
