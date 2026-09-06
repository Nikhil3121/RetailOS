/**
 * Application router.
 *
 * Two branches:
 *   /login, /forgot-password, /reset-password   — public
 *   everything else                              — behind RequireAuth
 *
 * `createHashRouter` is used deliberately: the packaged Electron bundle loads
 * from `file://`, and BrowserRouter (HTML5 history) doesn't play well with that.
 */
import { createHashRouter, Navigate } from 'react-router-dom';

import { RequireAuth } from '@/components/auth/RequireAuth';
import { AppShell } from '@/components/layout/AppShell';
import { ChangePassword } from '@/pages/ChangePassword';
import { Customers } from '@/pages/Customers';
import { Dashboard } from '@/pages/Dashboard';
import { Inventory } from '@/pages/Inventory';
import { Reports } from '@/pages/Reports';
import { Settings } from '@/pages/Settings';
import { Stores } from '@/pages/Stores';
import { Suppliers } from '@/pages/Suppliers';
import { HardwareDiagnostics } from '@/pages/settings/HardwareDiagnostics';
import { SystemStatus } from '@/pages/SystemStatus';
import { Users } from '@/pages/Users';
import { ForgotPassword } from '@/pages/auth/ForgotPassword';
import { Login } from '@/pages/auth/Login';
import { ResetPassword } from '@/pages/auth/ResetPassword';
import { Brands } from '@/pages/catalog/Brands';
import { Categories } from '@/pages/catalog/Categories';
import { ProductEditor } from '@/pages/catalog/ProductEditor';
import { Products } from '@/pages/catalog/Products';
import { PriceLists } from '@/pages/catalog/PriceLists';
import { Units } from '@/pages/catalog/Units';
import { Billing } from '@/pages/billing/Billing';
import { OutstandingDues } from '@/pages/billing/OutstandingDues';
import { DaySessionPage } from '@/pages/pos/DaySession';
import { Invoice } from '@/pages/pos/Invoice';
import { SaleReturn } from '@/pages/pos/SaleReturn';
import { LocalInvoice } from '@/pages/pos/LocalInvoice';
import { Sales } from '@/pages/pos/Sales';
import { PurchaseEditor } from '@/pages/purchases/PurchaseEditor';
import { Purchases } from '@/pages/purchases/Purchases';
import { CommissionRules } from '@/pages/team/CommissionRules';
import { Commissions } from '@/pages/team/Commissions';
import { StaffDirectory } from '@/pages/team/StaffDirectory';
import { StaffPerformance } from '@/pages/team/StaffPerformance';
import { StaffTargets } from '@/pages/team/StaffTargets';
import { Campaigns } from '@/pages/crm/Campaigns';
import { Coupons } from '@/pages/crm/Coupons';
import { Loyalty } from '@/pages/crm/Loyalty';
import { Rewards } from '@/pages/crm/Rewards';
import { LabelPrint } from '@/pages/catalog/LabelPrint';
import { StockCount } from '@/pages/inventory/StockCount';
import { CustomerDetail } from '@/pages/crm/CustomerDetail';
import { InventoryHealth } from '@/pages/insights/InventoryHealth';
import { PurchaseAnalytics } from '@/pages/insights/PurchaseAnalytics';
import { ExpenseReports } from '@/pages/finance/ExpenseReports';
import { Expenses } from '@/pages/finance/Expenses';
import { NotificationRules } from '@/pages/notifications/NotificationRules';
import { Notifications } from '@/pages/notifications/Notifications';
import { AuditLog } from '@/pages/admin/AuditLog';

export const router = createHashRouter([
  { path: '/login', element: <Login /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          // The "open your day session first" prompt is enforced ONCE at
          // login time in [pages/auth/Login.tsx] via decidePostLoginRoute.
          // We deliberately don't wrap these routes in a permanent gate —
          // once the user is inside the app, clicking Dashboard just
          // shows the dashboard, no redirect games.
          { path: 'dashboard', element: <Dashboard /> },
          { path: 'billing', element: <Billing /> },
          { path: 'billing/outstanding', element: <OutstandingDues /> },
          { path: 'sales', element: <Sales /> },
          { path: 'sales/:id/invoice', element: <Invoice /> },
          { path: 'sales/:id/return', element: <SaleReturn /> },
          // Offline receipt — reads the durable SQLite sale, no network.
          { path: 'sales/local/:id/invoice', element: <LocalInvoice /> },
          { path: 'system', element: <SystemStatus /> },
          { path: 'hardware', element: <HardwareDiagnostics /> },
          { path: 'stores', element: <Stores /> },
          { path: 'settings', element: <Settings /> },
          { path: 'change-password', element: <ChangePassword /> },

          // Catalog
          { path: 'products', element: <Products /> },
          { path: 'products/new', element: <ProductEditor /> },
          { path: 'products/:id', element: <ProductEditor /> },
          { path: 'categories', element: <Categories /> },
          { path: 'brands', element: <Brands /> },
          { path: 'units', element: <Units /> },
          { path: 'price-lists', element: <PriceLists /> },

          // Operations
          { path: 'inventory', element: <Inventory /> },
          { path: 'suppliers', element: <Suppliers /> },
          { path: 'customers', element: <Customers /> },
          { path: 'customers/:id', element: <CustomerDetail /> },
          { path: 'purchases', element: <Purchases /> },
          { path: 'purchases/new', element: <PurchaseEditor /> },
          { path: 'purchases/:id', element: <PurchaseEditor /> },

          // CRM
          { path: 'coupons', element: <Coupons /> },
          { path: 'loyalty', element: <Loyalty /> },
          { path: 'rewards', element: <Rewards /> },
          { path: 'labels', element: <LabelPrint /> },
          { path: 'stock-count', element: <StockCount /> },
          {
            path: 'campaigns',
            element: <RequireAuth minRole="manager" />,
            children: [{ index: true, element: <Campaigns /> }],
          },

          // Finance
          { path: 'expenses', element: <Expenses /> },
          {
            path: 'expense-reports',
            element: <RequireAuth minRole="manager" />,
            children: [{ index: true, element: <ExpenseReports /> }],
          },

          // Notifications
          { path: 'notifications', element: <Notifications /> },
          {
            path: 'notification-rules',
            element: <RequireAuth minRole="manager" />,
            children: [{ index: true, element: <NotificationRules /> }],
          },
          {
            path: 'audit-log',
            element: <RequireAuth minRole="owner" />,
            children: [{ index: true, element: <AuditLog /> }],
          },

          { path: 'day-session', element: <DaySessionPage /> },

          // Manager+ area
          {
            path: 'reports',
            element: <RequireAuth minRole="manager" />,
            children: [{ index: true, element: <Reports /> }],
          },
          {
            path: 'inventory-health',
            element: <RequireAuth minRole="manager" />,
            children: [{ index: true, element: <InventoryHealth /> }],
          },
          {
            path: 'purchase-analytics',
            element: <RequireAuth minRole="manager" />,
            children: [{ index: true, element: <PurchaseAnalytics /> }],
          },
          {
            path: 'users',
            element: <RequireAuth minRole="manager" />,
            children: [{ index: true, element: <Users /> }],
          },
          {
            path: 'staff-directory',
            element: <RequireAuth minRole="manager" />,
            children: [{ index: true, element: <StaffDirectory /> }],
          },
          {
            path: 'staff-performance',
            element: <RequireAuth minRole="manager" />,
            children: [{ index: true, element: <StaffPerformance /> }],
          },
          {
            path: 'commissions',
            element: <RequireAuth minRole="manager" />,
            children: [{ index: true, element: <Commissions /> }],
          },
          {
            path: 'staff-targets',
            element: <RequireAuth minRole="manager" />,
            children: [{ index: true, element: <StaffTargets /> }],
          },
          {
            path: 'commission-rules',
            element: <RequireAuth minRole="owner" />,
            children: [{ index: true, element: <CommissionRules /> }],
          },
          { path: '*', element: <Navigate to="/dashboard" replace /> },
        ],
      },
    ],
  },
]);
