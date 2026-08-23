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

import { DaySessionGate } from '@/components/auth/DaySessionGate';
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
import { SystemStatus } from '@/pages/SystemStatus';
import { Users } from '@/pages/Users';
import { ForgotPassword } from '@/pages/auth/ForgotPassword';
import { Login } from '@/pages/auth/Login';
import { ResetPassword } from '@/pages/auth/ResetPassword';
import { Brands } from '@/pages/catalog/Brands';
import { Categories } from '@/pages/catalog/Categories';
import { ProductEditor } from '@/pages/catalog/ProductEditor';
import { Products } from '@/pages/catalog/Products';
import { Units } from '@/pages/catalog/Units';
import { Billing } from '@/pages/billing/Billing';
import { OutstandingDues } from '@/pages/billing/OutstandingDues';
import { DaySessionPage } from '@/pages/pos/DaySession';
import { Invoice } from '@/pages/pos/Invoice';
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
          // Dashboard + billing-adjacent pages assume there's an open day
          // session for the current user's store. If there isn't, the
          // DaySessionGate bounces the user to /day-session; opening a
          // shift there sends them straight back to whatever they were
          // originally trying to open (defaulting to /dashboard).
          {
            element: <DaySessionGate />,
            children: [
              { path: 'dashboard', element: <Dashboard /> },
              { path: 'billing', element: <Billing /> },
              { path: 'billing/outstanding', element: <OutstandingDues /> },
              { path: 'sales', element: <Sales /> },
              { path: 'sales/:id/invoice', element: <Invoice /> },
            ],
          },
          { path: 'system', element: <SystemStatus /> },
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

          // Day-session is deliberately OUTSIDE DaySessionGate — it's
          // the page the gate redirects to when no session is open, so
          // gating it would create a loop.
          { path: 'day-session', element: <DaySessionPage /> },
          // NOTE: sales/, sales/:id/invoice, billing, billing/outstanding
          // are declared above inside the DaySessionGate wrapper.

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
