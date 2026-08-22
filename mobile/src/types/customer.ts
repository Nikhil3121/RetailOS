export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  company_name: string | null;
  date_of_birth: string | null;
  anniversary: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerCreate {
  name: string;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  city?: string | null;
  state?: string | null;
  notes?: string | null;
}
