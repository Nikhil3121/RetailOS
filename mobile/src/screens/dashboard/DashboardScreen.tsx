/**
 * DashboardScreen — the command centre. Always useful, even when the KPI
 * endpoint is down: Quick Actions render unconditionally so the operator
 * can jump straight into billing / products / customers / day-session from
 * the home tab.
 *
 * Structure: Greeting → Today's Overview (KPI grid or skeletons or error)
 * → Quick Actions → footer tip card.
 */

import type React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  DoorOpen,
  IndianRupee,
  Package,
  Percent,
  ShoppingCart,
  Users,
} from 'lucide-react-native';

import { GlassCard } from '@/components/GlassCard';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonKpi } from '@/components/Skeleton';
import { getDashboardSummary, type DashboardSummary } from '@/api/dashboard-api';
import { inr } from '@/lib/money';
import { colors, radius, spacing, typo } from '@/constants/theme';
import { useAuthStore } from '@/stores/auth-store';

export function DashboardScreen(): React.JSX.Element {
  const user = useAuthStore((s) => s.user);
  const navigation = useNavigation();

  const query = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => getDashboardSummary(),
    retry: 0,
  });

  const firstName = user?.full_name?.split(' ')[0] ?? 'there';

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={query.isFetching}
          onRefresh={() => query.refetch()}
          tintColor={colors.primary300}
        />
      }
    >
      <PageHeader
        title={`Hello, ${firstName}.`}
        description="Here's what's happening at the counter today."
      />

      {/* KPI grid — real / skeleton / error, one contract */}
      <View>
        <Text style={styles.sectionLabel}>Today's overview</Text>
        {query.isLoading ? (
          <View style={styles.grid}>
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i} style={styles.gridCell}>
                <SkeletonKpi />
              </View>
            ))}
          </View>
        ) : query.isError || !query.data ? (
          <GlassCard>
            <Text style={styles.errTitle}>Metrics aren't reachable right now.</Text>
            <Text style={styles.errHint}>
              Pull down to retry. Meanwhile, use the quick actions below — bills and
              sales don't depend on this endpoint.
            </Text>
          </GlassCard>
        ) : (
          <KpiGrid summary={query.data} />
        )}
      </View>

      {/* Quick actions — ALWAYS visible so the home tab is useful */}
      <View>
        <Text style={styles.sectionLabel}>Quick actions</Text>
        <View style={styles.actionsGrid}>
          <QuickAction
            icon={<ShoppingCart size={18} color={colors.white} />}
            label="New bill"
            hint="POS · scan · save"
            onPress={() => (navigation as any).navigate('Bill')}
            variant="primary"
          />
          <QuickAction
            icon={<Package size={18} color={colors.primary300} />}
            label="Products"
            hint="9,189 in catalog"
            onPress={() => (navigation as any).navigate('Products')}
          />
          <QuickAction
            icon={<Users size={18} color={colors.aurora400} />}
            label="Customers"
            hint="Directory · add · view"
            onPress={() => (navigation as any).navigate('More', { screen: 'CustomersRoot' })}
          />
          <QuickAction
            icon={<DoorOpen size={18} color={colors.warning300} />}
            label="Day session"
            hint="Open / close counter"
            onPress={() => (navigation as any).navigate('More', { screen: 'DaySession' })}
          />
        </View>
      </View>
    </ScrollView>
  );
}

function KpiGrid({ summary }: { summary: DashboardSummary }): React.JSX.Element {
  const items = [
    { label: 'Revenue',    value: inr(summary.revenue.value),               tone: 'primary' as const, icon: <IndianRupee size={14} color={colors.white} /> },
    { label: 'Bills',      value: Number(summary.sales_count.value).toLocaleString('en-IN'), tone: 'success' as const, icon: <Package size={14} color={colors.white} /> },
    { label: 'Avg bill',   value: inr(summary.avg_order_value.value),       tone: 'primary' as const, icon: <BarChart3 size={14} color={colors.white} /> },
    { label: 'Customers',  value: Number(summary.unique_customers.value).toLocaleString('en-IN'), tone: 'aurora' as const,  icon: <Users size={14} color={colors.white} /> },
    { label: 'Tax',        value: inr(summary.tax_collected.value),         tone: 'slate' as const,   icon: <Percent size={14} color={colors.white} /> },
    { label: 'Discounts',  value: inr(summary.discounts_given.value),       tone: 'slate' as const,   icon: <Percent size={14} color={colors.white} /> },
  ];

  return (
    <View style={styles.grid}>
      {items.map((it) => (
        <View key={it.label} style={styles.gridCell}>
          <KpiCard {...it} />
        </View>
      ))}
    </View>
  );
}

function KpiCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: 'primary' | 'success' | 'aurora' | 'slate';
  icon: React.ReactNode;
}): React.JSX.Element {
  const iconBg =
    tone === 'primary' ? colors.primary600
    : tone === 'success' ? colors.success500
    : tone === 'aurora'  ? colors.aurora500
    : 'rgba(255,255,255,0.10)';

  return (
    <GlassCard padding={14}>
      <View style={styles.kpiHeader}>
        <Text style={styles.kpiLabel}>{label}</Text>
        <View style={[styles.kpiIcon, { backgroundColor: iconBg }]}>{icon}</View>
      </View>
      <Text style={styles.kpiValue} numberOfLines={1}>{value}</Text>
    </GlassCard>
  );
}

function QuickAction({
  icon,
  label,
  hint,
  onPress,
  variant = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onPress: () => void;
  variant?: 'default' | 'primary';
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        variant === 'primary' && styles.actionPrimary,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View
        style={[
          styles.actionIcon,
          variant === 'primary' && { backgroundColor: 'rgba(255,255,255,0.16)' },
        ]}
      >
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionLabel, variant === 'primary' && { color: colors.white }]}>
          {label}
        </Text>
        <Text style={[styles.actionHint, variant === 'primary' && { color: 'rgba(255,255,255,0.75)' }]}>
          {hint}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing[4],
    paddingBottom: spacing[10],
    gap: spacing[6],
  },
  sectionLabel: {
    ...typo.label,
    color: colors.slate500,
    marginBottom: spacing[3],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  gridCell: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  kpiHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  kpiLabel: {
    ...typo.caption,
    color: colors.slate400,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  kpiIcon: {
    height: 28,
    width: 28,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  kpiValue: {
    ...typo.h2,
    color: colors.white,
  },
  errTitle: {
    ...typo.bodyMd,
    color: colors.slate200,
  },
  errHint: {
    ...typo.small,
    color: colors.slate500,
    marginTop: spacing[2],
  },
  actionsGrid: {
    gap: spacing[2],
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionPrimary: {
    backgroundColor: colors.primary600,
    borderColor: colors.primary500,
  },
  actionIcon: {
    height: 40,
    width: 40,
    borderRadius: radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  actionLabel: {
    ...typo.bodyMd,
    color: colors.white,
  },
  actionHint: {
    ...typo.small,
    color: colors.slate400,
    marginTop: 2,
  },
});
