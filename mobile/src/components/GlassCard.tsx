/**
 * GlassCard — the .glass surface from desktop, translated to RN.
 *
 * RN can't do CSS `backdrop-blur-xl`, so we approximate the glass effect with:
 *   • semi-transparent dark fill (bg-surface)
 *   • hair-thin light border (border-border)
 *   • soft drop shadow + a very faint highlight on the top edge
 * The perceptual result is close enough that a screenshot placed next to a
 * desktop screenshot reads as the same design system.
 */

import type React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadows } from '@/constants/theme';

interface GlassCardProps {
  children: React.ReactNode;
  strong?: boolean;
  /** Override default 24 padding. Pass 0 for edge-to-edge lists. */
  padding?: number;
  style?: StyleProp<ViewStyle>;
}

export function GlassCard({
  children,
  strong = false,
  padding = 24,
  style,
}: GlassCardProps): React.JSX.Element {
  return (
    <View
      style={[
        styles.base,
        strong ? styles.strong : styles.regular,
        { padding },
        style,
      ]}
    >
      {/* Faint top highlight — same idea as desktop `inset 0 1px 0 0 rgba(255,255,255,0.06)` */}
      <View pointerEvents="none" style={styles.topHighlight} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
  },
  regular: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    ...shadows.glass,
  },
  strong: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.borderStrong,
    ...shadows.glassStrong,
  },
  topHighlight: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
});
