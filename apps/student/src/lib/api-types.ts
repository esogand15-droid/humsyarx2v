/* Type definitions for API layer — extracted from api.ts for clean imports */

export type AccountState =
  | 'anonymous'
  | 'active'
  | 'pending_approval'
  | 'suspended'
  | 'not_registered';

export interface PublicUser {
  id: number;
  name: string;
  username: string;
  student_id: string;
  group: string;
  intake: string;
  role: string;
  registered_at: string;
}

export interface SessionPayload {
  authenticated: boolean;
  state: AccountState;
  user: PublicUser | null;
}

export interface StartPayload {
  ok: boolean;
  challenge: string;
  channel: 'telegram';
  hint: string;
  resend_in: number;
  expires_in: number;
  debug_code?: string;
}

export interface VerifyPayload {
  ok: boolean;
  state: AccountState;
  user: PublicUser;
}

export interface AuthConfig {
  otp_length: number;
  otp_ttl_sec: number;
  resend_in: number;
  session_days: number;
  channels: string[];
  support_url: string | null;
}

export interface LoginChallengeResponse {
  challenge_id: string;
  status: 'pending_telegram_approval';
  expires_in_seconds: number;
  display_code: string;
}

export interface LoginChallengeStatusResponse {
  status: 'pending_telegram_approval' | 'approved' | 'rejected' | 'expired';
  authenticated: boolean;
  user?: PublicUser;
}

export interface UserSessionItem {
  session_id: string;
  device_name: string;
  ip_address: string;
  is_current: boolean;
  created_at: string;
  last_active: string;
}