/**
 * MoreScreen — grouped landing for everything that doesn't earn its own
 * bottom tab. Sections mirror desktop's sidebar grouping so the mental
 * map stays the same across platforms.
 *
 *   OPERATIONS   Day session · Outstanding dues
 *   MANAGEMENT   Customers
 *   SYSTEM       Settings
 *   ACCOUNT      Sign out
 */

import type React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ChevronRight,
  DoorOpen,
  IndianRupee,
  LogOut,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react-native';

import { GlassCard } from '@/components/GlassCard';
import { PageHeader } from '@/components/PageHeader';
import { colors, radius, spacing, typo } from '@/constants/theme';
import { useAuthStore } from '@/stores/auth-store';
import { ROLE_LABEL } from '@/types/auth';
import type { MoreStackParamList } from '@/navigation/stacks/MoreStack';

interface Row {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onPress: () => void;
}

export function MoreScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MoreStackParamList>>();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const operations: Row[] = [
    {
      icon: <DoorOpen size={18} color={colors.primary300} />,
      label: 'Day session',
      hint: 'Open / close the counter, reconcile cash',
      onPress: () => navigation.navigate('DaySession'),
    },
    {
      icon: <IndianRupee size={18} color={colors.warning300} />,
      label: 'Outstanding dues',
      hint: 'Bills with a balance — collect a payment',
      onPress: () => navigation.navigate('OutstandingDues'),
    },
  ];

  const management: Row[] = [
    {
      icon: <Users size={18} color={colors.aurora400} />,
      label: 'Customers',
      hint: 'Directory · search · add · detail',
      onPress: () => navigation.navigate('CustomersRoot'),
    },
  ];

  const system: Row[] = [
    {
      icon: <SettingsIcon size={18} color={colors.slate300} />,
      label: 'Settings',
      hint: 'Account + backend + connection',
      onPress: () => navigation.navigate('Settings'),
    },
  ];

  const account: Row[] = [
    {
      icon: <LogOut size={18} color={colors.danger300} />,
      label: 'Sign out',
      hint: user?.email ?? '',
      onPress: () => {
        Alert.alert('Sign out?', 'You will need to re-enter your password to come back in.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign out', style: 'destructive', onPress: () => logout() },
        ]);
      },
    },
  ];

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <PageHeader
        title="More"
        description={user ? `${user.full_name} · ${ROLE_LABEL[user.role]}` : undefined}
      />

      <Section title="Operations" rows={operations} />
      <Section title="Management" rows={management} />
      <Section title="System"     rows={system} />
      <Section title="Account"    rows={account} tone="danger" />

      <Text style={styles.footer}>RetailOS Mobile · pilot build</Text>
    </ScrollView>
  );
}

function Section({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: Row[];
  tone?: 'danger';
}): React.JSX.Element {
  return (
    <View>
      <Text style={[styles.sectionLabel, tone === 'danger' && { color: colors.danger300 }]}>
        {title}
      </Text>
      <GlassCard padding={0}>
        {rows.map((r, i) => (
          <View key={r.label}>
            <RowItem row={r} />
            {i < rows.length - 1 ? <View style={styles.divider} /> : null}
          </View>
        ))}
      </GlassCard>
    </View>
  );
}

function RowItem({ row }: { row: Row }): React.JSX.Element {
  return (
    <Pressable onPress={row.onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.rowIcon}>{row.icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{row.label}</Text>
        {row.hint ? <Text style={styles.rowHint} numberOfLines={1}>{row.hint}</Text> : null}
      </View>
      <ChevronRight size={16} color={colors.slate500} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing[4],
    paddingBottom: spacing[10],
    gap: spacing[5],
  },
  sectionLabel: {
    ...typo.label,
    color: colors.slate500,
    marginBottom: spacing[2],
    paddingHorizontal: spacing[1],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3] + 2,
  },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  rowIcon: {
    height: 40,
    width: 40,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowLabel: {
    ...typo.bodyMd,
    color: colors.white,
  },
  rowHint: {
    ...typo.small,
    color: colors.slate500,
    marginTop: 2,
  },
  divider: {
    height: 1,
    marginLeft: 68,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  footer: {
    ...typo.caption,
    color: colors.slate600,
    textAlign: 'center',
    marginTop: spacing[3],
  },
});
