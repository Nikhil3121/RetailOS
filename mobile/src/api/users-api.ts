import { apiRequest } from '@/api/api';
import type { Paginated } from '@/types/common';
import type { StaffUser } from '@/types/user';

export function listUsers(page = 1, pageSize = 200): Promise<Paginated<StaffUser>> {
  return apiRequest({ path: `/users?page=${page}&page_size=${pageSize}`, method: 'GET' });
}

export function findUserByStaffCode(code: string): Promise<StaffUser> {
  return apiRequest({ path: `/users/by-staff-code/${encodeURIComponent(code)}`, method: 'GET' });
}
