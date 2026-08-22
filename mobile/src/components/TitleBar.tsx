/**
 * TitleBar — persistent app-shell top bar.
 *
 * Left  : Logo tile (24 px) + wordmark ("Retail" medium + "OS" bold).
 * Right : status chip + avatar with initials.
 *
 * Renders inside SafeAreaView so it clears the Android status bar cleanly.
 * Height is 48 px — tight enough to preserve screen real-estate on small
 * phones, tall enough for the logo + wordmark to breathe.
 */

import type React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/Logo';
import { colors, radius, spacing, typo } from '@/constants/theme';
import { useAuthStore } from '@/stores/auth-store';

function initials(name: string | null | undefined): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '·';
}

export function TitleBar(): React.JSX.Element {
  const user = useAuthStore((s) => s.user);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.bar}>
        <View style={styles.brand}>
          <Logo size={26} />
          <Text style={styles.wordmark}>
            Retail<Text style={styles.wordmarkBold}>OS</Text>
          </Text>
        </View>

        <View style={styles.right}>
          <View style={styles.onlineChip}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>Online</Text>
          </View>
          <View style={styles.userChip}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(user?.full_name)}</Text>
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: 'rgba(10,13,22,0.75)',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bar: {
    height: 48,
    paddingHorizontal: spacing[3],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexShrink: 1,
  },
  wordmark: {
    ...typo.body,
    color: colors.slate200,
    letterSpacing: -0.2,
  },
  wordmarkBold: {
    ...typo.bodyMd,
    fontFamily: typo.button.fontFamily, // semibold Inter
    color: colors.white,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexShrink: 0,
  },
  onlineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.30)',
    backgroundColor: 'rgba(16,185,129,0.10)',
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.success500,
  },
  onlineText: {
    ...typo.caption,
    color: colors.success300,
    fontFamily: typo.smallMd.fontFamily,
  },
  userChip: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    height: 28,
    width: 28,
    borderRadius: radius.full,
    backgroundColor: colors.primary600,
    borderWidth: 1,
    borderColor: colors.primary400,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    ...typo.caption,
    color: colors.white,
    fontFamily: typo.button.fontFamily,
  },
});
