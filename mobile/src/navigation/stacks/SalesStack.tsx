import type React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SaleDetailScreen } from '@/screens/sales/SaleDetailScreen';
import { SalesScreen } from '@/screens/sales/SalesScreen';

export type SalesStackParamList = {
  SalesList: undefined;
  SaleDetail: { saleId: string };
};

const Stack = createNativeStackNavigator<SalesStackParamList>();

export function SalesStack(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SalesList" component={SalesScreen} />
      <Stack.Screen name="SaleDetail" component={SaleDetailScreen} />
    </Stack.Navigator>
  );
}
