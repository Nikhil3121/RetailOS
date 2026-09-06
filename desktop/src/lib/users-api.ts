import { apiRequest } from '@/lib/api';
import type { CurrentUser, UserRole } from '@/types/auth';

export interface UsersPage {
  items: CurrentUser[];
  total: number;
  page: number;
  page_size: number;
}

export interface CreateUserBody {
  email: string;
  full_name: string;
  role: UserRole;
  password: string;
  store_id?: string | null;
  is_active?: boolean;
  phone?: string | null;
  /** Omit to have the server auto-generate STF-####. */
  staff_code?: string | null;
  commission_pct?: string | null;
}

export interface UpdateUserBody {
  full_name?: string;
  role?: UserRole;
  store_id?: string | null;
  is_active?: boolean;
  phone?: string | null;
  staff_code?: string | null;
  commission_pct?: string | null;
  /**
   * Set a new password for this user. Omit to leave it unchanged.
   *
   * An owner needs this because shop staff forget passwords weekly and the
   * email reset assumes a working mailbox they may not have. Setting it signs
   * the user out of every other session.
   */
  password?: string;
}

export function listUsers(page = 1, pageSize = 50): Promise<UsersPage> {
  return apiRequest<UsersPage>({
    path: `/users?page=${page}&page_size=${pageSize}`,
    method: 'GET',
  });
}

export function createUser(body: CreateUserBody): Promise<CurrentUser> {
  return apiRequest<CurrentUser>({ path: '/users', method: 'POST', body });
}

export function updateUser(id: string, body: UpdateUserBody): Promise<CurrentUser> {
  return apiRequest<CurrentUser>({ path: `/users/${id}`, method: 'PATCH', body });
}

export function deleteUser(id: string): Promise<void> {
  return apiRequest<void>({ path: `/users/${id}`, method: 'DELETE' });
}

export function findUserByStaffCode(code: string): Promise<CurrentUser> {
  return apiRequest<CurrentUser>({
    path: `/users/by-staff-code/${encodeURIComponent(code)}`,
    method: 'GET',
  });
}
