/**
 * MainTabs — the authenticated shell.
 *
 * Five tabs, each a stack navigator so per-tab drill-downs stay contained:
 *   Home      → DashboardScreen (KPIs)
 *   Bill      → NewBillScreen · HeldBillsScreen
 *   Sales     → SalesScreen · SaleDetailScreen
 *   Products  → ProductsScreen · ProductDetailScreen
 *   More      → MoreScreen · DaySession · Outstanding · Customers · Settings
 */

import type React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { LayoutDashboard, MoreHorizontal, Package, Receipt, ShoppingCart } from 'lucide-react-native';

import { BillingStack } from '@/navigation/stacks/BillingStack';
import { DashboardScreen } from '@/screens/dashboard/DashboardScreen';
import { MoreStack } from '@/navigation/stacks/MoreStack';
import { ProductsStack } from '@/navigation/stacks/ProductsStack';
import { SalesStack } from '@/navigation/stacks/SalesStack';

const Tab = createBottomTabNavigator();

import { colors } from '@/constants/theme';

const ACTIVE = colors.cobalt300;
const INACTIVE = colors.slate500;

export function MainTabs(): React.JSX.Element {
  return (
    <Tab.Navigator
      initialRouteName="Bill"
      screenOptions={{
        sceneStyle: { backgroundColor: 'transparent' },
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          // Glassy — matches desktop sidebar's `bg-ink-900/60 backdrop-blur-xl`.
          backgroundColor: 'rgba(10,13,22,0.85)',
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500', letterSpacing: 0.2 },
      }}
    >
      <Tab.Screen
        name="Home"
        component={DashboardScreen}
        options={{ tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} /> }}
      />
      <Tab.Screen
        name="Bill"
        component={BillingStack}
        options={{ tabBarIcon: ({ color, size }) => <ShoppingCart color={color} size={size} /> }}
      />
      <Tab.Screen
        name="Sales"
        component={SalesStack}
        options={{ tabBarIcon: ({ color, size }) => <Receipt color={color} size={size} /> }}
      />
      <Tab.Screen
        name="Products"
        component={ProductsStack}
        options={{ tabBarIcon: ({ color, size }) => <Package color={color} size={size} /> }}
      />
      <Tab.Screen
        name="More"
        component={MoreStack}
        options={{ tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} /> }}
      />
    </Tab.Navigator>
  );
}
