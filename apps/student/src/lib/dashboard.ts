/* لایهٔ دادهٔ داشبورد (موج P2 / M1) — ویجت‌های مرکز فرماندهی دانشجو از /api/web/dashboard */
import { apiCall } from './api';

export interface DashboardUser {
  name: string;
  nickname?: string;
  display_name: string;
  intake: string;
  group: string;
  role: string;
  student_id?: string;
}

export interface DashboardStats {
  total_answers: number;
  correct_answers: number;
  accuracy: number;
  streak_days: number;
  weak_topics: string[];
}

export interface UpcomingExam {
  id: string;
  lesson: string;
  date: string;
  time: string;
  days_left: number | null;
  course_code?: string;
  teacher?: string;
  location?: string;
}

export interface PrestigeStreak {
  current: number;
  best: number;
}

export interface PrestigeState {
  xp?: number;
  level?: number;
  level_title?: string;
  rank?: string;
  streak?: PrestigeStreak;
  exams_completed?: number;
  downloads_count?: number;
  achievements?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DashboardPayload {
  user: DashboardUser;
  stats: DashboardStats;
  upcoming_exams: UpcomingExam[];
  open_tickets: number;
  prestige: PrestigeState;
}

export interface WeeklyActivityItem {
  date: string;
  day?: string;
  count: number;
}

export interface WeeklyActivity {
  weekly: WeeklyActivityItem[];
}

export interface LeaderboardItem {
  rank: number;
  name: string;
  correct: number;
  total: number;
  percent: number;
  is_me: boolean;
}

export interface LeaderboardPayload {
  leaderboard: LeaderboardItem[];
}

export interface SubscriptionStatus {
  active: boolean;
  days_left: number;
  plan_name: string;
  expires: string;
  has_pending_payment?: boolean;
  resource_access?: boolean;
  enforced?: boolean;
}

export const dashboard = {
  overview: () => apiCall<DashboardPayload>('/dashboard'),
  weekly: () => apiCall<WeeklyActivity>('/dashboard/weekly'),
  leaderboard: (params?: { range?: string; scope?: string; tab?: string; limit?: number }) => {
    if (!params) {
      return apiCall<LeaderboardPayload>('/dashboard/leaderboard');
    }
    const q = new URLSearchParams();
    if (params.range) q.set('range_', params.range);
    if (params.scope) q.set('scope', params.scope);
    if (params.tab) q.set('tab', params.tab);
    if (params.limit) q.set('limit', String(params.limit));
    return apiCall<LeaderboardPayload>(`/dashboard/leaderboard?${q.toString()}`);
  },
  subscriptionStatus: () => apiCall<SubscriptionStatus>('/subscription/status'),
};
