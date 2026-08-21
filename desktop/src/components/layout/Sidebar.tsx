import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity,
  Award,
  BarChart3,
  Bell,
  BellDot,
  Boxes,
  History,
  ChevronsLeft,
  ChevronsRight,
  Coins,
  DoorOpen,
  FolderTree,
  IndianRupee,
  LayoutDashboard,
  Megaphone,
  PackageSearch,
  Receipt,
  ReceiptText,
  Ruler,
  Scale,
  Server,
  Settings,
  ShoppingCart,
  Store,
  Tag,
  Target,
  TicketPercent,
  Truck,
  Users,
  Wallet2,
} from 'lucide-react';
import type { ComponentType } from 'react';

import { cn } from '@/lib/cn';
import { useUIStore } from '@/stores/ui-store';
import { useAuthStore } from '@/stores/auth-store';
import type { UserRole } from '@/types/auth';

interface NavItem {
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  minRole?: UserRole;
  disabled?: boolean;
  milestone?: string;
  section?: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Sales', to: '/sales', icon: Receipt, minRole: 'cashier' },
  { label: 'Day session', to: '/day-session', icon: DoorOpen, minRole: 'cashier' },

  // -- Billing ----------------------------------------------------------
  { section: 'Billing', label: 'New bill', to: '/billing', icon: ReceiptText, minRole: 'cashier' },
  { label: 'Outstanding dues', to: '/billing/outstanding', icon: IndianRupee, minRole: 'cashier' },

  // -- Catalog ----------------------------------------------------------
  { section: 'Catalog', label: 'Products', to: '/products', icon: Boxes, minRole: 'cashier' },
  { label: 'Categories', to: '/categories', icon: FolderTree, minRole: 'cashier' },
  { label: 'Brands', to: '/brands', icon: Tag, minRole: 'cashier' },
  { label: 'Units', to: '/units', icon: Ruler, minRole: 'cashier' },

  // -- Operations -------------------------------------------------------
  { section: 'Operations', label: 'Inventory', to: '/inventory', icon: ShoppingCart, minRole: 'cashier' },
  { label: 'Purchases', to: '/purchases', icon: Receipt, minRole: 'cashier' },
  { label: 'Customers', to: '/customers', icon: Users, minRole: 'cashier' },
  { label: 'Suppliers', to: '/suppliers', icon: Truck, minRole: 'cashier' },

  // -- CRM --------------------------------------------------------------
  { section: 'CRM', label: 'Coupons', to: '/coupons', icon: TicketPercent, minRole: 'manager' },
  { label: 'Campaigns', to: '/campaigns', icon: Megaphone, minRole: 'manager' },

  // -- Team -------------------------------------------------------------
  { section: 'Team', label: 'Staff directory', to: '/staff-directory', icon: Users, minRole: 'manager' },
  { label: 'Staff performance', to: '/staff-performance', icon: Award, minRole: 'manager' },
  { label: 'Commissions', to: '/commissions', icon: Coins, minRole: 'manager' },
  { label: 'Commission rules', to: '/commission-rules', icon: Scale, minRole: 'owner' },
  { label: 'Targets', to: '/staff-targets', icon: Target, minRole: 'manager' },

  // -- Finance ----------------------------------------------------------
  { section: 'Finance', label: 'Expenses', to: '/expenses', icon: Wallet2, minRole: 'cashier' },
  { label: 'Expense reports & P&L', to: '/expense-reports', icon: Scale, minRole: 'manager' },

  // -- Insights ---------------------------------------------------------
  { section: 'Insights', label: 'Reports', to: '/reports', icon: BarChart3, minRole: 'manager' },
  { label: 'Inventory health', to: '/inventory-health', icon: PackageSearch, minRole: 'manager' },
  { label: 'Purchase analytics', to: '/purchase-analytics', icon: Activity, minRole: 'manager' },

  // -- Administration ---------------------------------------------------
  { section: 'Admin', label: 'Stores', to: '/stores', icon: Store, minRole: 'cashier' },
  { label: 'Users', to: '/users', icon: Users, minRole: 'manager' },
  { label: 'Notifications', to: '/notifications', icon: Bell },
  { label: 'Notification rules', to: '/notification-rules', icon: BellDot, minRole: 'manager' },
  { label: 'Audit log', to: '/audit-log', icon: History, minRole: 'owner' },
  { label: 'System', to: '/system', icon: Server },
  { label: 'Settings', to: '/settings', icon: Settings },
];

/**
 * Return every NAV_ITEM sorted A→Z by label, ignoring the original section
 * groupings. Section headers are dropped — one clean flat list is what the
 * shopkeeper asked for so they don't have to remember which category a
 * screen lives under.
 */
function flattenAndSort(items: readonly NavItem[]): NavItem[] {
  return [...items]
    .map(({ section: _section, ...rest }) => rest)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function Sidebar(): JSX.Element {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const hasMinRole = useAuthStore((s) => s.hasMinRole);

  // Sort once at module boot (NAV_ITEMS is constant), then filter by role on
  // every render so RBAC changes reflect immediately.
  const sorted = useMemo(() => flattenAndSort(NAV_ITEMS), []);
  const visible = sorted.filter((i) => !i.minRole || hasMinRole(i.minRole));

  return (
    <aside
      className={cn(
        'relative flex h-full shrink-0 flex-col border-r border-border/70 bg-ink-900/60 backdrop-blur-xl transition-[width] duration-200 ease-out',
        collapsed ? 'w-[76px]' : 'w-[248px]',
      )}
    >
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visible.map((item) => (
          <SidebarLink key={item.to} item={item} collapsed={collapsed} />
        ))}
      </nav>

      <button
        type="button"
        onClick={toggle}
        className="flex items-center justify-center gap-2 border-t border-border/70 py-3 text-xs font-medium text-slate-500 transition hover:bg-white/[0.03] hover:text-slate-200"
      >
        {collapsed ? (
          <ChevronsRight className="h-4 w-4" />
        ) : (
          <>
            <ChevronsLeft className="h-4 w-4" />
            <span>Collapse</span>
          </>
        )}
      </button>
    </aside>
  );
}

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }): JSX.Element {
  const Icon = item.icon;

  if (item.disabled) {
    return (
      <div
        title={`${item.label} — available in ${item.milestone}`}
        className={cn(
          'flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-600 opacity-70',
          collapsed && 'justify-center',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            <span className="rounded-md border border-border bg-white/[0.02] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-500">
              {item.milestone}
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
          collapsed && 'justify-center',
          isActive
            ? 'bg-gradient-to-r from-cobalt-800/60 to-cobalt-600/30 text-white shadow-glow'
            : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-100',
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
}
