import type React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HeldBillsScreen } from '@/screens/billing/HeldBillsScreen';
import { NewBillScreen } from '@/screens/billing/NewBillScreen';

export type BillingStackParamList = {
  NewBill: { resumeHeldId?: string } | undefined;
  HeldBills: undefined;
};

const Stack = createNativeStackNavigator<BillingStackParamList>();

export function BillingStack(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="NewBill" component={NewBillScreen} />
      <Stack.Screen name="HeldBills" component={HeldBillsScreen} />
    </Stack.Navigator>
  );
}
