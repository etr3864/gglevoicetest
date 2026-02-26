export interface Contact {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  gender: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  totalCalls: number;
  totalDurationSec: number;
  lastCallAt: string | null;
  createdAt: string;
}

export interface UpdateContactBody {
  name?: string | null;
  email?: string | null;
  gender?: 'male' | 'female' | 'unknown' | null;
  notes?: string | null;
}
