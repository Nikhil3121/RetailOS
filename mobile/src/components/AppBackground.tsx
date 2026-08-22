/**
 * AppBackground — the deep-ink base + aurora radial gradients + 48px grid
 * overlay that the desktop paints behind every page (see index.css `body`
 * background-image + `.grid-overlay`).
 *
 * Uses react-native-svg for radial gradients (RN's LinearGradient can't do
 * radial) and Pattern for the grid. Static — child screens just render
 * their scroll content on top; the background never scrolls or reflows.
 */

import type React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { aurora, colors } from '@/constants/theme';

interface AppBackgroundProps {
  children: React.ReactNode;
  /** Slightly dim the grid; useful on scroll surfaces where the grid can distract. */
  gridOpacity?: number;
}

export function AppBackground({ children, gridOpacity = 0.6 }: AppBackgroundProps): React.JSX.Element {
  return (
    <View style={styles.root}>
      {/* Aurora radial gradients — three stacked blooms matching desktop */}
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="aurora-a" cx={aurora.a.cx} cy={aurora.a.cy} rx={aurora.a.rx} ry={aurora.a.ry}>
            <Stop offset="0%" stopColor={aurora.a.color} stopOpacity={aurora.a.opacity} />
            <Stop offset="100%" stopColor={aurora.a.color} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="aurora-b" cx={aurora.b.cx} cy={aurora.b.cy} rx={aurora.b.rx} ry={aurora.b.ry}>
            <Stop offset="0%" stopColor={aurora.b.color} stopOpacity={aurora.b.opacity} />
            <Stop offset="100%" stopColor={aurora.b.color} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="aurora-c" cx={aurora.c.cx} cy={aurora.c.cy} rx={aurora.c.rx} ry={aurora.c.ry}>
            <Stop offset="0%" stopColor={aurora.c.color} stopOpacity={aurora.c.opacity} />
            <Stop offset="100%" stopColor={aurora.c.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#aurora-a)" />
        <Rect width="100%" height="100%" fill="url(#aurora-b)" />
        <Rect width="100%" height="100%" fill="url(#aurora-c)" />
      </Svg>

      {/* 48px grid overlay — matches desktop `.grid-overlay` */}
      <Svg pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: gridOpacity }]}>
        <Defs>
          <Pattern id="grid" width={48} height={48} patternUnits="userSpaceOnUse">
            <Path
              d="M 48 0 L 0 0 0 48"
              stroke="rgba(255,255,255,0.035)"
              strokeWidth={1}
              fill="none"
            />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#grid)" />
      </Svg>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ink950,
  },
});
