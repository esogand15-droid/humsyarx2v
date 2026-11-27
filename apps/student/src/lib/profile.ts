import { apiCall } from './api';

export interface ProfileUser {
  name: string;
  intake: string;
  intake_label: string;
  group: string;
  computed_group: string;
  registered_group: string;
  educational_group: string;
  group_source: string;
  group_verified: boolean;
  ai_suggested_group?: string;
  needs_educational_group_confirmation?: boolean;
  student_id: string;
  web_login_code: string;
  role: string;
  nickname: string;
  display_name: string;
  can_change_nickname: boolean;
  next_change_at?: string | null;
  show_real_name: boolean;
  nickname_cooldown_days: number;
}

export interface ProfilePayload {
  user: ProfileUser;
  stats: {
    total_answers?: number;
    correct_answers?: number;
    percentage?: number;
    downloads?: number;
  };
  tickets: { open: number; closed: number };
}

export interface IntakeItem {
  code: string;
  label: string;
}

export interface LeaderboardRow {
  uid: number;
  rank: number;
  name: string;
  icon?: string;
  color?: string;
  roman?: string;
  value: number;
  jump?: number | null;
  is_me?: boolean;
}

export interface LeaderboardPayload {
  rows?: LeaderboardRow[];
  me?: LeaderboardRow & { gap_next?: number };
  rival_above?: { name: string; icon?: string; gap: number } | null;
  rival_below?: { name: string; icon?: string; gap: number } | null;
  season?: { label?: string } | null;
}

export interface FeedItem {
  id: string;
  text: string;
  at_jalali?: string;
  reactions?: Record<string, number>;
  my_reaction?: string | null;
}

export interface ProgressiveBadge {
  key: string;
  icon: string;
  title: string;
  color?: string;
  tier: number;
  tiers_count: number;
  tiers?: number[];
  value: number;
  next_target?: number | null;
  next_xp?: number | null;
}

export interface SingleBadge {
  key: string;
  kind: string;
  icon: string;
  title: string;
  desc: string;
  color?: string;
  earned: boolean;
  secret?: boolean;
  count?: number;
}

export interface GlobalBadge {
  key: string;
  icon: string;
  title: string;
  claimed?: boolean;
  owned_by_me?: boolean;
  owner_name?: string;
}

export interface BadgesPayload {
  showcase: string[];
  progressive: ProgressiveBadge[];
  singles: SingleBadge[];
  global: GlobalBadge[];
}

export interface PrestigeState {
  tier?: number;
  tier_name?: string;
  tier_icon?: string;
  tier_color?: string;
  xp?: number;
  effective_xp?: number;
  next_tier_xp?: number | null;
  privacy_public?: boolean;
}

export interface PrestigeHistoryItem {
  title: string;
  delta?: number;
  at_jalali?: string;
  icon?: string;
}

export interface ReferralMine {
  enabled: boolean;
  code?: string;
  link?: string;
  stats?: { invited?: number; activated?: number; rewards_earned?: number };
  rewards?: Record<string, { on?: boolean; value?: number; label?: string }>;
}

export interface FaqItem {
  id: string;
  category?: string;
  question: string;
  answer: string;
}

export const profileApi = {
  get: () => apiCall<ProfilePayload>('/api/profile'),
  intakes: () => apiCall<{ intakes: IntakeItem[] }>('/api/profile/intakes'),
  updateName: (name: string) =>
    apiCall<{ ok: boolean; name: string }>('/api/profile/name', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  updateNickname: (nickname: string) =>
    apiCall<{ ok: boolean; nickname: string; display_name: string }>('/api/profile/nickname', {
      method: 'PATCH',
      body: JSON.stringify({ nickname }),
    }),
  updatePrivacy: (show_real_name: boolean) =>
    apiCall<{ ok: boolean; show_real_name: boolean }>('/api/profile/privacy', {
      method: 'PATCH',
      body: JSON.stringify({ show_real_name }),
    }),
  updateGroup: (group: '1' | '2') =>
    apiCall<{ ok: boolean; group: string }>('/api/profile/group', {
      method: 'PATCH',
      body: JSON.stringify({ group }),
    }),
  updateEducationalGroup: (educational_group: 'male' | 'female') =>
    apiCall<{ ok: boolean; educational_group: string }>('/api/profile/educational-group', {
      method: 'PATCH',
      body: JSON.stringify({ educational_group }),
    }),
  updateIntake: (intake: string) =>
    apiCall<{ ok: boolean; intake: string }>('/api/profile/intake', {
      method: 'PATCH',
      body: JSON.stringify({ intake }),
    }),
  updateStudentId: (student_id: string) =>
    apiCall<{ ok: boolean; student_id: string }>('/api/profile/student-id', {
      method: 'PATCH',
      body: JSON.stringify({ student_id }),
    }),
  regenerateWebCode: () =>
    apiCall<{ ok: boolean; web_login_code: string }>('/api/profile/web-code/regenerate', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  prestige: () => apiCall<{ prestige: PrestigeState }>('/api/profile/prestige'),
  prestigeBadges: () => apiCall<{ badges: BadgesPayload }>('/api/profile/prestige/badges'),
  prestigeHistory: (limit = 40) =>
    apiCall<{ items: PrestigeHistoryItem[] }>(`/api/profile/prestige/history?limit=${limit}`),
  setShowcase: (keys: string[]) =>
    apiCall<{ ok?: boolean; showcase?: Array<{ key: string }> }>('/api/profile/prestige/showcase', {
      method: 'PUT',
      body: JSON.stringify({ keys }),
    }),
  setPrestigePrivacy: (isPublic: boolean) =>
    apiCall<{ ok: boolean; privacy_public: boolean }>('/api/profile/prestige/privacy', {
      method: 'PATCH',
      body: JSON.stringify({ public: isPublic }),
    }),
  donation: () => apiCall<{ enabled: boolean; link: string }>('/api/profile/donation'),
  leaderboard: (params: { range_: string; scope: string; tab: string; limit?: number }) => {
    const q = new URLSearchParams({
      range_: params.range_,
      scope: params.scope,
      tab: params.tab,
      limit: String(params.limit ?? 50),
    });
    return apiCall<LeaderboardPayload>(`/api/dashboard/leaderboard?${q.toString()}`);
  },
  feed: (limit = 8) => apiCall<{ items: FeedItem[] }>(`/api/dashboard/feed?limit=${limit}`),
  reactFeed: (event_id: string, kind: 'clap' | 'fire' | 'crown' | null) =>
    apiCall<{ ok?: boolean }>('/api/dashboard/feed/react', {
      method: 'POST',
      body: JSON.stringify({ event_id, kind }),
    }),
  referral: () => apiCall<ReferralMine>('/api/referral/mine'),
  faq: () =>
    apiCall<{ categories: Array<{ name: string; items: FaqItem[] }> }>('/api/faq'),
  faqSearch: (q: string) =>
    apiCall<{ results: FaqItem[] }>(`/api/faq/search?q=${encodeURIComponent(q)}`),
};
