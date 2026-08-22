/**
 * Auth types — ported verbatim from desktop/src/types/auth.ts so the shape
 * the API returns is understood identically on both platforms. When the
 * backend contract changes, update both files (or promote them to a shared
 * package/core — see mobile/README.md).
 */

export type UserRole = 'super_admin' | 'owner' | 'manager' | 'cashier' | 'staff';

export interface CurrentUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  store_id: string | null;
  is_active: boolean;
  phone: string | null;
  staff_code: string | null;
  commission_pct: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  owner: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
  staff: 'Staff',
};

export const ROLE_PRIORITY: Record<UserRole, number> = {
  staff: 10,
  cashier: 20,
  manager: 40,
  owner: 80,
  super_admin: 100,
};

export function hasMinRole(role: UserRole | undefined, min: UserRole): boolean {
  if (!role) return false;
  return ROLE_PRIORITY[role] >= ROLE_PRIORITY[min];
}
