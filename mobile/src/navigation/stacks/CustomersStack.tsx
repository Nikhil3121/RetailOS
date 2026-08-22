import type React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CustomerDetailScreen } from '@/screens/customers/CustomerDetailScreen';
import { CustomersScreen } from '@/screens/customers/CustomersScreen';
import { NewCustomerScreen } from '@/screens/customers/NewCustomerScreen';

export type CustomersStackParamList = {
  CustomersList: undefined;
  CustomerDetail: { customerId: string };
  NewCustomer: undefined;
};

const Stack = createNativeStackNavigator<CustomersStackParamList>();

export function CustomersStack(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CustomersList" component={CustomersScreen} />
      <Stack.Screen name="CustomerDetail" component={CustomerDetailScreen} />
      <Stack.Screen name="NewCustomer" component={NewCustomerScreen} />
    </Stack.Navigator>
  );
}
