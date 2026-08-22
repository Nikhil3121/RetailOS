/**
 * PageHeader — mirror of desktop/src/components/ui/PageHeader.tsx.
 *
 * Left column holds the title + optional description; right column takes an
 * arbitrary actions node (chips, buttons). Every screen uses this so page
 * headings look identical across the app.
 */

import type React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps): React.JSX.Element {
  return (
    <View style={styles.root}>
      <View style={styles.textCol}>
        <Text style={styles.title}>{title}</Text>
        {description ? <Text style={styles.desc}>{description}</Text> : null}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  desc: {
    marginTop: 4,
    color: colors.slate400,
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
