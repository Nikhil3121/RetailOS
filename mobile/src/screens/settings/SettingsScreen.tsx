/**
 * SettingsScreen — account + backend info card. Design system aligned.
 */

import type React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LogOut, Cloud, Store as StoreIcon, User } from 'lucide-react-native';

import { Button } from '@/components/Button';
import { GlassCard } from '@/components/GlassCard';
import { PageHeader } from '@/components/PageHeader';
import { API_BASE_URL } from '@/constants/env';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuthStore } from '@/stores/auth-store';
import { ROLE_LABEL } from '@/types/auth';

export function SettingsScreen(): React.JSX.Element {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <PageHeader title="Settings" description="Signed-in identity and connection." />

      <Section title="Account" icon={<User size={14} color={colors.slate400} />}>
        <KV k="Name" v={user?.full_name ?? '—'} />
        <KV k="Email" v={user?.email ?? '—'} />
        <KV k="Role" v={user ? ROLE_LABEL[user.role] : '—'} />
        <KV k="Staff code" v={user?.staff_code ?? '—'} />
      </Section>

      <Section title="Store binding" icon={<StoreIcon size={14} color={colors.slate400} />}>
        <KV k="Assigned store" v={user?.store_id ? user.store_id.slice(0, 8) + '…' : 'All stores'} />
        <Text style={styles.hint}>
          The New Bill screen auto-selects the store with an open day session; this row shows
          the account's default binding.
        </Text>
      </Section>

      <Section title="Backend" icon={<Cloud size={14} color={colors.slate400} />}>
        <KV k="URL" v={API_BASE_URL.replace(/^https?:\/\//, '')} />
        <Text style={styles.hint}>
          Hosted on Render. First request after ~15 min idle may take ~30s while the free-tier
          instance wakes up.
        </Text>
      </Section>

      <Button
        label="Sign out"
        variant="secondary"
        leadingIcon={<LogOut size={18} color={colors.slate200} />}
        onPress={() => logout()}
      />

      <Text style={styles.footer}>RetailOS Mobile · pilot build</Text>
    </ScrollView>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <GlassCard>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </GlassCard>
  );
}

function KV({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={styles.kvVal} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing[4],
    paddingBottom: spacing[8],
    gap: spacing[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    color: colors.slate400,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  kvKey: { color: colors.slate500, fontSize: 11 },
  kvVal: { color: colors.slate100, fontSize: 13, maxWidth: '60%', textAlign: 'right' },
  hint: {
    marginTop: 8,
    color: colors.slate500,
    fontSize: 11,
    lineHeight: 16,
  },
  footer: {
    color: colors.slate600,
    fontSize: 10,
    textAlign: 'center',
    marginTop: spacing[3],
  },
});
