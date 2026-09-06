import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  Award,
  Gift,
  BarChart3,
  Bell,
  BellDot,
  Boxes,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Coins,
  DoorOpen,
  FolderTree,
  History,
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
  ShieldCheck,
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

/**
 * Sidebar navigation — grouped, collapsible edition.
 *
 * Structure loosely follows the pattern popular Indian POS apps (Vyapar,
 * Marg, Busy) use: a short list of standalone top-level items followed by
 * expandable groups. Each group's children are related features under
 * one banner — Sales lives with Day Session, Catalog holds Products +
 * Categories + Brands, etc. Shopkeepers can find any screen by
 * remembering the *category* it lives in instead of the exact name.
 *
 * Behaviour:
 *   - Click a group header → toggles its open state.
 *   - Only one group is open at a time (accordion) — keeps the sidebar
 *     short even on smaller laptops.
 *   - The group that owns the currently-active route auto-expands on
 *     first mount and on every route change, so refresh + deep-link
 *     always land the user with their group open.
 *   - When the sidebar is collapsed to icons (76px), groups render as
 *     an icon-only button; clicking one both expands the sidebar and
 *     opens that group.
 *   - Role gating cascades: a group with zero visible children hides
 *     itself entirely.
 */

interface NavItem {
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  minRole?: UserRole;
}

interface NavGroup {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  items: NavItem[];
  /** Optional minRole — if set, the group hides unless the caller has it. */
  minRole?: UserRole;
}

// Standalone items — no dropdown, always visible at the top of the sidebar.
const STANDALONE_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
];

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'sales',
    label: 'Sales',
    icon: Receipt,
    items: [
      { label: 'New bill', to: '/billing', icon: ReceiptText, minRole: 'cashier' },
      { label: 'Sales', to: '/sales', icon: Receipt, minRole: 'cashier' },
      { label: 'Day session', to: '/day-session', icon: DoorOpen, minRole: 'cashier' },
      { label: 'Outstanding dues', to: '/billing/outstanding', icon: IndianRupee, minRole: 'cashier' },
    ],
  },
  {
    key: 'catalog',
    label: 'Catalog',
    icon: Boxes,
    items: [
      { label: 'Products', to: '/products', icon: Boxes, minRole: 'cashier' },
      { label: 'Categories', to: '/categories', icon: FolderTree, minRole: 'cashier' },
      { label: 'Brands', to: '/brands', icon: Tag, minRole: 'cashier' },
      { label: 'Units', to: '/units', icon: Ruler, minRole: 'cashier' },
      { label: 'Price lists', to: '/price-lists', icon: Tag, minRole: 'manager' },
    ],
  },
  {
    key: 'operations',
    label: 'Operations',
    icon: ShoppingCart,
    items: [
      { label: 'Inventory', to: '/inventory', icon: ShoppingCart, minRole: 'cashier' },
      { label: 'Purchases', to: '/purchases', icon: Receipt, minRole: 'cashier' },
    ],
  },
  {
    key: 'parties',
    label: 'Parties',
    icon: Users,
    items: [
      { label: 'Customers', to: '/customers', icon: Users, minRole: 'cashier' },
      { label: 'Suppliers', to: '/suppliers', icon: Truck, minRole: 'cashier' },
    ],
  },
  {
    key: 'crm',
    label: 'Marketing',
    icon: Megaphone,
    minRole: 'manager',
    items: [
      { label: 'Coupons', to: '/coupons', icon: TicketPercent, minRole: 'manager' },
      // Two neighbours that sound alike to a new cashier, so they say what
      // they are: points accrue over time, rewards are a gift on one bill.
      { label: 'Loyalty points', to: '/loyalty', icon: Award, minRole: 'manager' },
      { label: 'Rewards (gifts)', to: '/rewards', icon: Gift, minRole: 'manager' },
      { label: 'Campaigns', to: '/campaigns', icon: Megaphone, minRole: 'manager' },
    ],
  },
  {
    key: 'team',
    label: 'Team',
    icon: Award,
    minRole: 'manager',
    items: [
      { label: 'Staff directory', to: '/staff-directory', icon: Users, minRole: 'manager' },
      { label: 'Staff performance', to: '/staff-performance', icon: Award, minRole: 'manager' },
      { label: 'Commissions', to: '/commissions', icon: Coins, minRole: 'manager' },
      { label: 'Commission rules', to: '/commission-rules', icon: Scale, minRole: 'owner' },
      { label: 'Targets', to: '/staff-targets', icon: Target, minRole: 'manager' },
    ],
  },
  {
    key: 'finance',
    label: 'Cash & Finance',
    icon: Wallet2,
    items: [
      { label: 'Expenses', to: '/expenses', icon: Wallet2, minRole: 'cashier' },
      { label: 'Expense reports & P&L', to: '/expense-reports', icon: Scale, minRole: 'manager' },
    ],
  },
  {
    key: 'insights',
    label: 'Reports & Insights',
    icon: BarChart3,
    minRole: 'manager',
    items: [
      { label: 'Reports', to: '/reports', icon: BarChart3, minRole: 'manager' },
      { label: 'Inventory health', to: '/inventory-health', icon: PackageSearch, minRole: 'manager' },
      { label: 'Purchase analytics', to: '/purchase-analytics', icon: Activity, minRole: 'manager' },
    ],
  },
  {
    key: 'admin',
    label: 'Administration',
    icon: ShieldCheck,
    items: [
      { label: 'Stores', to: '/stores', icon: Store, minRole: 'cashier' },
      { label: 'Users', to: '/users', icon: Users, minRole: 'manager' },
      { label: 'Notifications', to: '/notifications', icon: Bell },
      { label: 'Notification rules', to: '/notification-rules', icon: BellDot, minRole: 'manager' },
      { label: 'Audit log', to: '/audit-log', icon: History, minRole: 'owner' },
      { label: 'System', to: '/system', icon: Server },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
];

// Every `to` above must be unique — SidebarLink keys its list on item.to,
// so two entries sharing a path trigger React's duplicate-key warning and
// one of them gets dropped from the rendered tree.

export function Sidebar(): JSX.Element {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const hasMinRole = useAuthStore((s) => s.hasMinRole);
  const location = useLocation();

  // Filter groups + items by role once per render. A group whose entire
  // roster is hidden by RBAC drops out too, so a cashier never sees an
  // empty "Admin" heading.
  const visibleGroups = useMemo(() => {
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.minRole || hasMinRole(i.minRole)),
    }))
      .filter((g) => (!g.minRole || hasMinRole(g.minRole)) && g.items.length > 0);
  }, [hasMinRole]);

  const visibleStandalone = useMemo(
    () => STANDALONE_ITEMS.filter((i) => !i.minRole || hasMinRole(i.minRole)),
    [hasMinRole],
  );

  // Auto-open the group that owns the current route so a deep-link
  // (e.g. /users) always reveals its parent (Administration) without
  // the user having to click.
  const activeGroupKey = useMemo(() => {
    for (const g of visibleGroups) {
      if (g.items.some((i) => location.pathname === i.to || location.pathname.startsWith(i.to + '/'))) {
        return g.key;
      }
    }
    return null;
  }, [visibleGroups, location.pathname]);

  // Accordion state — only one group open at a time. Seeded with the
  // active group so first paint doesn't hide the current page's parent.
  const [openKey, setOpenKey] = useState<string | null>(activeGroupKey);

  // If the route changes and lands the user inside a different group,
  // swap the open group along with it. Ignored while collapsed — the
  // user has explicitly asked for icon-only mode.
  useEffect(() => {
    if (activeGroupKey && activeGroupKey !== openKey) {
      setOpenKey(activeGroupKey);
    }
    // We deliberately only re-run when the active group changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupKey]);

  function onGroupClick(key: string): void {
    if (collapsed) {
      // In icon-only mode, tapping a group both expands the sidebar
      // and opens that group. Otherwise the click would be a no-op
      // from the user's point of view.
      setSidebarCollapsed(false);
      setOpenKey(key);
      return;
    }
    setOpenKey((prev) => (prev === key ? null : key));
  }

  return (
    <aside
      className={cn(
        'relative flex h-full shrink-0 flex-col border-r border-border/70 bg-ink-900/60 backdrop-blur-xl transition-[width] duration-200 ease-out',
        collapsed ? 'w-[76px]' : 'w-[248px]',
      )}
    >
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {/* Standalone items — always rendered flat, no dropdown. */}
        {visibleStandalone.map((item) => (
          <SidebarLink key={item.to} item={item} collapsed={collapsed} />
        ))}

        {/* Divider between standalone items and groups. */}
        {visibleStandalone.length > 0 && (
          <div className="my-2 h-px bg-border/50" />
        )}

        {/* Collapsible groups. */}
        {visibleGroups.map((group) => (
          <SidebarGroup
            key={group.key}
            group={group}
            open={openKey === group.key}
            collapsed={collapsed}
            onToggle={() => onGroupClick(group.key)}
          />
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

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function SidebarGroup({
  group,
  open,
  collapsed,
  onToggle,
}: {
  group: NavGroup;
  open: boolean;
  collapsed: boolean;
  onToggle: () => void;
}): JSX.Element {
  const Icon = group.icon;
  const location = useLocation();
  const hasActiveChild = group.items.some(
    (i) => location.pathname === i.to || location.pathname.startsWith(i.to + '/'),
  );

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onToggle}
        title={collapsed ? group.label : undefined}
        className={cn(
          'group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
          collapsed && 'justify-center',
          // Active-child styling: subtle glow so the user can tell which
          // group holds the current screen even when it's collapsed shut.
          hasActiveChild
            ? 'text-white'
            : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-100',
          hasActiveChild && !open && 'bg-white/[0.03]',
        )}
        aria-expanded={open}
      >
        <Icon
          className={cn(
            'h-4 w-4 shrink-0',
            hasActiveChild && 'text-cobalt-300',
          )}
        />
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left font-medium">
              {group.label}
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200',
                open && 'rotate-180 text-slate-200',
              )}
            />
          </>
        )}
      </button>

      {/* Children — hidden in collapsed mode (the whole panel is 76px
          wide, no room for a text list). Uses a max-height transition
          for a smooth reveal without measuring the child list. */}
      {!collapsed && (
        <div
          className={cn(
            'overflow-hidden transition-[max-height,opacity] duration-200 ease-out',
            open ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0',
          )}
        >
          <div className="ml-4 space-y-1 border-l border-border/40 pl-3 pt-1">
            {group.items.map((item) => (
              <SidebarLink key={item.to} item={item} collapsed={false} dense />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarLink({
  item,
  collapsed,
  dense,
}: {
  item: NavItem;
  collapsed: boolean;
  dense?: boolean;
}): JSX.Element {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg text-sm transition-colors',
          // Sub-items stay tighter than their parent group, but keep the same
          // left inset so every label in the tree shares one vertical edge —
          // alignment reads as order; a staggered indent reads as drift.
          dense ? 'px-3 py-1' : 'px-3 py-2',
          collapsed && 'justify-center',
          isActive
            ? 'bg-gradient-to-r from-cobalt-800/60 to-cobalt-600/30 text-white shadow-glow'
            : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-100',
        )
      }
      title={collapsed ? item.label : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
}
