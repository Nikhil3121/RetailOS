import type React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ProductDetailScreen } from '@/screens/products/ProductDetailScreen';
import { ProductsScreen } from '@/screens/products/ProductsScreen';

export type ProductsStackParamList = {
  ProductsList: undefined;
  ProductDetail: { productId: string };
};

const Stack = createNativeStackNavigator<ProductsStackParamList>();

export function ProductsStack(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProductsList" component={ProductsScreen} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} />
    </Stack.Navigator>
  );
}
