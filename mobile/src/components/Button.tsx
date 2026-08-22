/**
 * Button — matches desktop/src/components/ui/Button.tsx.
 *
 *   primary   → cobalt-500 → cobalt-700 gradient + glow shadow (main CTA)
 *   secondary → white-alpha fill + border (secondary action)
 *   ghost     → transparent, colored on hover/press (tertiary)
 *   danger    → rose-600 fill (destructive)
 *
 * Sizes match the desktop:
 *   sm  h-8  px-3   text-xs
 *   md  h-10 px-4   text-sm
 *   lg  h-12 px-6   text-base
 */

import type React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, radius, shadows } from '@/constants/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const SIZE = {
  sm: { height: 32, paddingHorizontal: 12, fontSize: 12 },
  md: { height: 42, paddingHorizontal: 16, fontSize: 14 },
  lg: { height: 48, paddingHorizontal: 24, fontSize: 16 },
} as const;

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  leadingIcon,
  trailingIcon,
  style,
}: ButtonProps): React.JSX.Element {
  const sz = SIZE[size];
  const isDisabled = disabled || loading;
  const opacity = isDisabled ? 0.6 : 1;

  const content = (
    <View style={[styles.content, { paddingHorizontal: sz.paddingHorizontal }]}>
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <>
          {leadingIcon}
          <Text
            style={[
              styles.label,
              { fontSize: sz.fontSize, color: variantTextColor(variant) },
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {trailingIcon}
        </>
      )}
    </View>
  );

  if (variant === 'primary') {
    return (
      <Pressable onPress={onPress} disabled={isDisabled} style={style}>
        <LinearGradient
          colors={[colors.cobalt500, colors.cobalt700]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[
            styles.base,
            styles.primary,
            { height: sz.height, opacity },
          ]}
        >
          {content}
        </LinearGradient>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variantContainerStyle(variant),
        { height: sz.height, opacity: pressed && !isDisabled ? 0.85 : opacity },
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

function variantTextColor(v: Variant): string {
  switch (v) {
    case 'primary':
    case 'danger':
      return colors.white;
    case 'secondary':
      return colors.slate100;
    case 'ghost':
      return colors.slate300;
  }
}

function variantContainerStyle(v: Variant): ViewStyle {
  switch (v) {
    case 'secondary':
      return {
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth: 1,
        borderColor: colors.border,
      };
    case 'ghost':
      return { backgroundColor: 'transparent' };
    case 'danger':
      return { backgroundColor: 'rgba(225,29,72,0.9)' };
    default:
      return {};
  }
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.xl,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  primary: {
    ...shadows.glow,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    fontWeight: '600',
    letterSpacing: -0.2,
  },
});
