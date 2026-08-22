/**
 * App root — mobile edition.
 *
 * Wraps the RootNavigator with:
 *   - Inter font loader (blocks first render until real weights land, so we
 *     never flash the synthesised-bold "ghosted" text that Android renders
 *     for weight 600 when no matching TTF is present)
 *   - QueryClientProvider so React Query works throughout the tree
 *   - SafeAreaProvider so screens can inset around notches / navigation bars
 *   - GestureHandlerRootView (required by React Navigation on Android)
 *   - StatusBar in "light" mode against our dark base
 *
 * NativeWind styles are activated by importing global.css — the Metro
 * plugin transforms it into a StyleSheet the RN runtime understands.
 */

import 'react-native-gesture-handler';
import './global.css';

import type React from 'react';
import { useEffect } from 'react';
import { Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';

import { RootNavigator } from '@/navigation/RootNavigator';
import { font } from '@/lib/fonts';
import { checkForOtaUpdate } from '@/lib/ota';
import { initSentry } from '@/lib/sentry';

// Fire once at module import — no-op in dev / when no DSN is configured.
// Kept at module scope (not inside App()) so a component re-render never
// re-initialises the SDK.
initSentry();

// Kick off an OTA check on cold start. Fire-and-forget — must never
// block first paint. Downloaded updates apply on the NEXT cold start
// so an active bill flow is never interrupted.
void checkForOtaUpdate();

// Keep the native splash up until Inter has landed. Without this the app
// briefly renders with fallback fonts + synthesised bold, causing the
// "outlined text" flash the user reported.
void SplashScreen.preventAutoHideAsync().catch(() => {});

// Set Inter Regular as the DEFAULT for every <Text> and <TextInput> in the
// tree. Individual styles can still override with `font.medium` / `.bold`.
// Also disables the OS "large text" scale so numbers in the POS never wrap
// unexpectedly on shopkeepers' phones with accessibility text turned up.
(Text as unknown as { defaultProps: object }).defaultProps ??= {};
Object.assign((Text as unknown as { defaultProps: object }).defaultProps, {
  allowFontScaling: false,
  style: { fontFamily: font.regular },
});
(TextInput as unknown as { defaultProps: object }).defaultProps ??= {};
Object.assign((TextInput as unknown as { defaultProps: object }).defaultProps, {
  allowFontScaling: false,
  style: { fontFamily: font.regular },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Match desktop defaults — proactive-refresh in api.ts keeps 401s off
      // the wire, so we can afford a modest stale window.
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App(): React.JSX.Element | null {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    // Splash is still up — nothing to render. Once fonts land the effect
    // above hides splash and the real tree mounts, guaranteeing every
    // Text on first paint uses real Inter (no synthesis).
    return <View style={{ flex: 1, backgroundColor: '#05070d' }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <RootNavigator />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
