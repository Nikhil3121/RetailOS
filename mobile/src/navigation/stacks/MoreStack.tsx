import type React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CustomersStack } from '@/navigation/stacks/CustomersStack';
import { DaySessionScreen } from '@/screens/day-session/DaySessionScreen';
import { MoreScreen } from '@/screens/MoreScreen';
import { OutstandingDuesScreen } from '@/screens/billing/OutstandingDuesScreen';
import { SettingsScreen } from '@/screens/settings/SettingsScreen';

export type MoreStackParamList = {
  MoreHome: undefined;
  DaySession: undefined;
  OutstandingDues: undefined;
  CustomersRoot: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<MoreStackParamList>();

export function MoreStack(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MoreHome" component={MoreScreen} />
      <Stack.Screen name="DaySession" component={DaySessionScreen} />
      <Stack.Screen name="OutstandingDues" component={OutstandingDuesScreen} />
      <Stack.Screen name="CustomersRoot" component={CustomersStack} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}
