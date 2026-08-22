/**
 * Skeleton — animated placeholder while data loads. Prefer this over an
 * ActivityIndicator on list screens: the shimmer keeps the layout stable
 * (no jump when the real content lands) and communicates "loading" in the
 * shape of what's coming.
 *
 * <SkeletonBlock w={80} h={12} />         one bar
 * <SkeletonRow />                         a full card-shaped row
 */

import type React from 'react';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

interface SkeletonBlockProps {
  w?: number | string;
  h?: number;
  r?: number;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonBlock({
  w = '100%',
  h = 12,
  r = 6,
  style,
}: SkeletonBlockProps): React.JSX.Element {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
  }, [shimmer]);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.8] });

  return (
    <Animated.View
      style={[
        {
          width: w as number,
          height: h,
          borderRadius: r,
          backgroundColor: 'rgba(255,255,255,0.06)',
          opacity,
        },
        style,
      ]}
    />
  );
}

/** A card-shaped skeleton row for list screens (Products, Sales, Customers). */
export function SkeletonRow(): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonBlock w={'70%'} h={14} />
        <SkeletonBlock w={'45%'} h={10} />
      </View>
      <SkeletonBlock w={64} h={14} />
    </View>
  );
}

/** KPI card skeleton — matches the shape of the Dashboard tile. */
export function SkeletonKpi(): React.JSX.Element {
  return (
    <View style={styles.kpi}>
      <SkeletonBlock w={'40%'} h={10} />
      <View style={{ marginTop: 12 }}>
        <SkeletonBlock w={'70%'} h={22} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3] + 2,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing[3],
  },
  kpi: {
    padding: spacing[4],
    borderRadius: radius['2xl'],
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 92,
  },
});
