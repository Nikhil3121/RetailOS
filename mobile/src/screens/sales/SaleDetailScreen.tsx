/**
 * SaleDetailScreen — full invoice for a saved bill.
 *
 * Opens from the Sales list. Shows lines, payments, totals, and a
 * "Share receipt" button that spins up a system-print / share dialog
 * via expo-print (system dialog can print to any Bluetooth printer the
 * user has paired to Android, without us shipping a native module).
 */

import type React from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Printer, Share2 } from 'lucide-react-native';

import { Button } from '@/components/Button';
import { getSale } from '@/api/sales-api';
import { inr } from '@/lib/money';
import { PAYMENT_LABEL, type Sale } from '@/types/sale';
import type { SalesStackParamList } from '@/navigation/stacks/SalesStack';

function receiptHtml(sale: Sale, storeName?: string): string {
  const linesHtml = sale.lines
    .map(
      (l) =>
        `<tr>
          <td>${escapeHtml(l.product_name)}<br/><small>SKU ${escapeHtml(l.sku)}</small></td>
          <td style="text-align:right">${l.quantity}</td>
          <td style="text-align:right">${inr(l.unit_price)}</td>
          <td style="text-align:right">${inr(l.line_total)}</td>
        </tr>`,
    )
    .join('');

  return `
    <html>
      <head>
        <meta charset="utf-8"/>
        <style>
          body { font-family: -apple-system, Roboto, sans-serif; padding: 24px; color: #111; }
          h1 { margin: 0 0 4px; font-size: 20px; }
          .muted { color: #555; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
          th, td { padding: 6px 4px; border-bottom: 1px solid #eee; text-align: left; }
          .totals { margin-top: 12px; font-size: 13px; }
          .totals div { display: flex; justify-content: space-between; padding: 2px 0; }
          .totals .grand { border-top: 2px solid #111; font-weight: 700; margin-top: 4px; padding-top: 6px; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(storeName ?? 'RetailOS')}</h1>
        <div class="muted">Bill: <b>${escapeHtml(sale.number)}</b></div>
        <div class="muted">Date: ${new Date(sale.created_at).toLocaleString('en-IN')}</div>

        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th style="text-align:right">Qty</th>
              <th style="text-align:right">Rate</th>
              <th style="text-align:right">Amount</th>
            </tr>
          </thead>
          <tbody>${linesHtml}</tbody>
        </table>

        <div class="totals">
          <div><span>Subtotal (ex. GST)</span><span>${inr(sale.subtotal)}</span></div>
          <div><span>Discount</span><span>${inr(sale.discount_total)}</span></div>
          <div><span>Tax (embedded)</span><span>${inr(sale.tax_total)}</span></div>
          <div class="grand"><span>Grand total</span><span>${inr(sale.grand_total)}</span></div>
          <div><span>Paid</span><span>${inr(sale.paid_total)}</span></div>
          ${Number(sale.balance_due) > 0
            ? `<div><span>Balance due</span><span>${inr(sale.balance_due)}</span></div>`
            : ''}
        </div>

        <p class="muted" style="margin-top: 24px; text-align: center;">
          Thank you for shopping with us.
        </p>
      </body>
    </html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function SaleDetailScreen(): React.JSX.Element {
  const route = useRoute<RouteProp<SalesStackParamList, 'SaleDetail'>>();
  const { saleId } = route.params;
  const saleQuery = useQuery({
    queryKey: ['sale', saleId],
    queryFn: () => getSale(saleId),
  });

  const sale = saleQuery.data;

  async function onPrint(): Promise<void> {
    if (!sale) return;
    try {
      await Print.printAsync({ html: receiptHtml(sale) });
    } catch (err) {
      Alert.alert('Print failed', err instanceof Error ? err.message : String(err));
    }
  }

  async function onShare(): Promise<void> {
    if (!sale) return;
    try {
      const { uri } = await Print.printToFileAsync({ html: receiptHtml(sale) });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Bill ${sale.number}` });
      }
    } catch (err) {
      Alert.alert('Share failed', err instanceof Error ? err.message : String(err));
    }
  }

  if (saleQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-ink-950">
        <ActivityIndicator color="#5f8aff" />
      </SafeAreaView>
    );
  }

  if (saleQuery.isError || !sale) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-ink-950 p-6">
        <Text className="text-center text-slate-300">Couldn't load this bill.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-ink-950" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Text className="text-2xl font-semibold text-white">{sale.number}</Text>
        <Text className="mt-1 text-sm text-slate-400">
          {new Date(sale.created_at).toLocaleString('en-IN')}
          {sale.status === 'voided' ? ' · VOIDED' : ''}
        </Text>

        <View className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <Text className="mb-2 text-xs uppercase tracking-wider text-slate-500">Items</Text>
          {sale.lines.map((l) => (
            <View key={l.id} className="border-b border-white/5 py-2 last:border-b-0">
              <View className="flex-row justify-between">
                <Text className="flex-1 pr-2 text-sm text-white">{l.product_name}</Text>
                <Text className="text-sm font-semibold text-white">{inr(l.line_total)}</Text>
              </View>
              <Text className="mt-0.5 text-[11px] text-slate-500">
                SKU {l.sku} · {Number(l.quantity)} × {inr(l.unit_price)}
                {Number(l.tax_rate) > 0 ? ` · GST ${Number(l.tax_rate)}%` : ''}
              </Text>
            </View>
          ))}
        </View>

        <View className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <Row label="Subtotal" value={inr(sale.subtotal)} />
          {Number(sale.discount_total) > 0 && <Row label="Discount" value={`− ${inr(sale.discount_total)}`} />}
          <Row label="Tax (embedded)" value={inr(sale.tax_total)} muted />
          <View className="my-2 h-px bg-white/10" />
          <Row label="Grand total" value={inr(sale.grand_total)} bold />
          <Row label="Paid" value={inr(sale.paid_total)} />
          {Number(sale.balance_due) > 0 && (
            <Row label="Balance due" value={inr(sale.balance_due)} highlight="amber" />
          )}
          {Number(sale.change_due) > 0 && (
            <Row label="Change" value={inr(sale.change_due)} highlight="emerald" />
          )}
        </View>

        {sale.payments.length > 0 && (
          <View className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <Text className="mb-2 text-xs uppercase tracking-wider text-slate-500">Payments</Text>
            {sale.payments.map((p) => (
              <Row key={p.id} label={PAYMENT_LABEL[p.method]} value={inr(p.amount)} />
            ))}
          </View>
        )}

        <View className="mt-5 gap-2">
          <Button label="Print receipt" leadingIcon={<Printer size={16} color="#fff" />} onPress={onPrint} />
          <Button label="Share as PDF" variant="secondary" leadingIcon={<Share2 size={16} color="#e2e8f0" />} onPress={onShare} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
  highlight,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
  highlight?: 'amber' | 'emerald';
}): React.JSX.Element {
  const color =
    highlight === 'amber' ? 'text-amber-300' : highlight === 'emerald' ? 'text-emerald-300' : bold ? 'text-white' : muted ? 'text-slate-400' : 'text-slate-100';
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className={bold ? 'text-sm font-semibold text-white' : 'text-xs text-slate-400'}>
        {label}
      </Text>
      <Text className={`${bold ? 'text-base font-semibold' : 'text-sm'} ${color}`}>{value}</Text>
    </View>
  );
}
