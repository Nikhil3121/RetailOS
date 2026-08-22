import type React from 'react';
/**
 * RootNavigator — top-level switch between the auth stack (unauthenticated)
 * and the main app (authenticated). Uses the auth store's `status` field as
 * the switch: bootstrap() flips it from 'idle' → 'loading' → 'authenticated'
 * or 'guest' during app boot; login() → 'authenticated' after credentials;
 * logout() → 'guest' immediately.
 *
 * For the pilot we ship a single "Home" screen once authenticated. Real
 * bottom tabs (Bill / Sales / Products / Settings) come in Phase 2.
 */

import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AppBackground } from '@/components/AppBackground';
import { TitleBar } from '@/components/TitleBar';
import { LoginScreen } from '@/screens/auth/LoginScreen';
import { MainTabs } from '@/navigation/MainTabs';
import { colors } from '@/constants/theme';
import { useAuthStore } from '@/stores/auth-store';

const AuthStack = createNativeStackNavigator();

function AuthNavigator(): React.JSX.Element {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
    </AuthStack.Navigator>
  );
}

function AppNavigator(): React.JSX.Element {
  // Authenticated shell: TitleBar sits above the bottom-tab tree so it
  // stays consistent as the user moves between tabs, matching desktop's
  // AppShell (TitleBar + Sidebar + Outlet).
  return (
    <>
      <TitleBar />
      <MainTabs />
    </>
  );
}

// Match the app's dark base so the underlying container never flashes white
// during transitions.
const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: 'transparent',
    card: 'transparent',
    text: colors.slate200,
    border: colors.border,
    primary: colors.cobalt400,
    notification: colors.rose500,
  },
};

export function RootNavigator(): React.JSX.Element {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    // Fires once when the tree mounts. If the persisted refresh token is
    // still valid, we re-hydrate the user + jump straight to Home; if not
    // (or if we never had one), we land on Login.
    void bootstrap();
  }, [bootstrap]);

  const authed = status === 'authenticated';
  const loading = status === 'idle' || status === 'loading';

  return (
    <NavigationContainer theme={navTheme}>
      <AppBackground>
        {loading ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={colors.cobalt300} />
          </View>
        ) : authed ? (
          <AppNavigator />
        ) : (
          <AuthNavigator />
        )}
      </AppBackground>
    </NavigationContainer>
  );
}
