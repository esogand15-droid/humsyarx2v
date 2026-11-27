import { useCallback, useEffect, useState } from 'react';

import { apiCall } from './api';

export interface InboxNotification {
  id: string;
  title: string;
  body: string;
  category?: string;
  read: boolean;
  pinned?: boolean;
  created_at?: string;
}

interface StoreState {
  items: InboxNotification[] | null;
  unread: number | null;
}

const state: StoreState = {
  items: null,
  unread: null,
};

const listeners = new Set<() => void>();
let unreadInflight: Promise<number> | null = null;
let inboxInflight: Promise<InboxNotification[]> | null = null;
let pollTimer = 0;
let subscriberCount = 0;

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore subscriber failure */
    }
  });
}

function countUnread(list: InboxNotification[]): number {
  let n = 0;
  for (const item of list) {
    if (!item.read) n++;
  }
  return n;
}

export async function refreshUnreadCount(): Promise<number> {
  if (unreadInflight) return unreadInflight;
  unreadInflight = (async () => {
    try {
      const res = await apiCall<{ unread: number }>('/api/notifications/inbox/unread-count');
      const count = Math.max(0, Number(res?.unread ?? 0));
      state.unread = count;
      emit();
      return count;
    } catch {
      try {
        const list = await refreshInbox();
        return countUnread(list);
      } catch {
        return state.unread ?? 0;
      }
    } finally {
      unreadInflight = null;
    }
  })();
  return unreadInflight;
}

export async function refreshInbox(): Promise<InboxNotification[]> {
  if (inboxInflight) return inboxInflight;
  inboxInflight = (async () => {
    try {
      const res = await apiCall<{ items: InboxNotification[]; unread?: number }>('/api/notifications/inbox');
      const items = Array.isArray(res?.items) ? res.items : [];
      state.items = items;
      state.unread = typeof res?.unread === 'number' ? Math.max(0, res.unread) : countUnread(items);
      emit();
      return items;
    } finally {
      inboxInflight = null;
    }
  })();
  return inboxInflight;
}

export async function markNotificationsRead(ids: string[] | null): Promise<void> {
  const prevItems = state.items;
  const prevUnread = state.unread;

  if (state.items) {
    state.items = state.items.map((item) =>
      ids === null || ids.includes(item.id) ? { ...item, read: true } : item,
    );
    state.unread = countUnread(state.items);
    emit();
  } else if (ids === null) {
    state.unread = 0;
    emit();
  } else if (typeof state.unread === 'number') {
    state.unread = Math.max(0, state.unread - ids.length);
    emit();
  }

  try {
    const res = await apiCall<{ ok: boolean; unread?: number }>('/api/notifications/inbox/read', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
    if (typeof res?.unread === 'number') {
      state.unread = Math.max(0, res.unread);
      emit();
    }
  } catch (err) {
    state.items = prevItems;
    state.unread = prevUnread;
    emit();
    throw err;
  }
}

export async function pinInboxNotification(id: string, pinned: boolean): Promise<void> {
  const prev = state.items;
  if (state.items) {
    state.items = state.items.map((item) => (item.id === id ? { ...item, pinned } : item));
    emit();
  }
  try {
    await apiCall<{ ok: boolean; pinned: boolean }>(`/api/notifications/inbox/${encodeURIComponent(id)}/pin`, {
      method: 'POST',
      body: JSON.stringify({ pinned }),
    });
  } catch (err) {
    state.items = prev;
    emit();
    throw err;
  }
}

export async function deleteInboxNotification(id: string): Promise<void> {
  const prevItems = state.items;
  const prevUnread = state.unread;
  if (state.items) {
    state.items = state.items.filter((item) => item.id !== id);
    state.unread = countUnread(state.items);
    emit();
  }
  try {
    const res = await apiCall<{ ok: boolean; unread?: number }>(
      `/api/notifications/inbox/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    if (typeof res?.unread === 'number') {
      state.unread = Math.max(0, res.unread);
      emit();
    }
  } catch (err) {
    state.items = prevItems;
    state.unread = prevUnread;
    emit();
    throw err;
  }
}

export interface NotificationSettingItem {
  key: string;
  label: string;
  desc: string;
  enabled: boolean;
}

export const notifSettingsApi = {
  get: () => apiCall<{ settings: NotificationSettingItem[] }>('/api/notifications/settings'),
  update: (settings: Record<string, boolean>) =>
    apiCall<{ ok: boolean }>('/api/notifications/settings', {
      method: 'PATCH',
      body: JSON.stringify({ settings }),
    }),
  toggleAll: (enabled: boolean) =>
    apiCall<{ ok: boolean; enabled: boolean }>('/api/notifications/settings/all', {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
};

export function resetNotificationsStore(): void {
  state.items = null;
  state.unread = null;
  emit();
}

function startPolling() {
  if (pollTimer || typeof window === 'undefined') return;
  const tick = () => {
    if (document.visibilityState === 'visible') {
      void refreshUnreadCount();
    }
  };
  pollTimer = window.setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', tick);
}

function stopPolling() {
  if (!pollTimer) return;
  window.clearInterval(pollTimer);
  pollTimer = 0;
}

export function useNotificationsState(options?: { loadInbox?: boolean }) {
  const [, setVersion] = useState(0);

  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    subscriberCount += 1;
    startPolling();

    if (options?.loadInbox) {
      if (state.items === null) {
        void refreshInbox().catch(() => undefined);
      }
    } else if (state.unread === null) {
      void refreshUnreadCount();
    }

    return () => {
      listeners.delete(listener);
      subscriberCount = Math.max(0, subscriberCount - 1);
      if (subscriberCount === 0) stopPolling();
    };
  }, [options?.loadInbox]);

  const reloadInbox = useCallback(() => refreshInbox(), []);
  const reloadUnread = useCallback(() => refreshUnreadCount(), []);

  return {
    items: state.items,
    unread: state.unread ?? (state.items ? countUnread(state.items) : 0),
    reloadInbox,
    reloadUnread,
  };
}
