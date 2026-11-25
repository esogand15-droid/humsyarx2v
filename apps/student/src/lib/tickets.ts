/* Support tickets (T4): the real /api/web/tickets API, which the bot and miniapp already use.
   It replaces the hardcoded fake conversation that TicketsScreen used to show. */
import { apiCall } from './api';

export type TicketStatus = 'open' | 'in_progress' | 'waiting_user' | 'resolved' | 'closed';

export interface TicketSummary {
  id: number;
  subject: string;
  status: TicketStatus;
  created_at: string | null;
  reply_count: number;
  priority: string;
}

export interface TicketMessage {
  text: string;
  sender: 'user' | 'support';
  at: string | null;
}

export interface TicketDetail extends TicketSummary {
  message: string;
  replies: TicketMessage[];
}

export const tickets = {
  list: () => apiCall<{ tickets: TicketSummary[]; subjects: string[] }>('/tickets'),
  get: (id: number) => apiCall<{ ticket: TicketDetail }>(`/tickets/${id}`),
  create: (subject: string, message: string) =>
    apiCall<{ ok: boolean; ticket_id: number }>('/tickets', {
      method: 'POST',
      body: JSON.stringify({ subject, message }),
    }),
  reply: (id: number, message: string) =>
    apiCall<{ ok: boolean }>(`/tickets/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
};

/** The server rejects a first message shorter than this (422). */
export const TICKET_MIN_MESSAGE = 10;

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'در انتظار پاسخ',
  in_progress: 'در حال بررسی',
  waiting_user: 'پاسخ داده شده',
  resolved: 'حل شده',
  closed: 'بسته شده',
};

export function statusTone(s: TicketStatus): 'cyan' | 'quiet' | 'brand' {
  if (s === 'waiting_user') return 'cyan';
  if (s === 'resolved' || s === 'closed') return 'quiet';
  return 'brand';
}

/** Solar Hijri date and time from the server's ISO timestamp; empty string if unknown. */
export function ticketTime(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'long', day: 'numeric' };
  try {
    return d.toLocaleString('fa-IR-u-ca-persian', opts);
  } catch {
    return d.toLocaleString('fa-IR', opts);
  }
}
