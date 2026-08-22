import type { UserRole } from '@/types/auth';

export interface StaffUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  store_id: string | null;
  staff_code: string | null;
  phone: string | null;
  commission_pct: string | null;
  is_active: boolean;
  totp_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}
