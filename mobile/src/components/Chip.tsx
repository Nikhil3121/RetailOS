/**
 * Chip — the little pill used across the desktop for status/delta/section
 * markers (Online chip, session banner, held-bills pill, delta % chip).
 *
 * Follows desktop's convention: coloured border + tinted fill + coloured
 * text, small type, rounded-full.
 */

import type React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius } from '@/constants/theme';

type Tone = 'slate' | 'cobalt' | 'aurora' | 'emerald' | 'amber' | 'rose';

interface ChipProps {
  label: string;
  tone?: Tone;
  leadingIcon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const TONE = {
  slate: {
    bg: 'rgba(255,255,255,0.04)',
    border: colors.border,
    text: colors.slate300,
  },
  cobalt: {
    bg: 'rgba(31,71,240,0.10)',
    border: 'rgba(31,71,240,0.30)',
    text: colors.cobalt200,
  },
  aurora: {
    bg: 'rgba(6,182,212,0.10)',
    border: 'rgba(6,182,212,0.30)',
    text: colors.aurora400,
  },
  emerald: {
    bg: 'rgba(16,185,129,0.10)',
    border: 'rgba(16,185,129,0.30)',
    text: colors.emerald300,
  },
  amber: {
    bg: 'rgba(245,158,11,0.10)',
    border: 'rgba(245,158,11,0.30)',
    text: colors.amber200,
  },
  rose: {
    bg: 'rgba(244,63,94,0.10)',
    border: 'rgba(244,63,94,0.30)',
    text: colors.rose300,
  },
} as const;

export function Chip({ label, tone = 'slate', leadingIcon, style }: ChipProps): React.JSX.Element {
  const t = TONE[tone];
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: t.bg, borderColor: t.border },
        style,
      ]}
    >
      {leadingIcon ? <View style={styles.icon}>{leadingIcon}</View> : null}
      <Text style={[styles.text, { color: t.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 10,
    gap: 6,
    alignSelf: 'flex-start',
  },
  icon: { justifyContent: 'center' },
  text: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
