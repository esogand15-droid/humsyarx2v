/* وضعیت پیامهای یک گفتوگوی هوشیار: بارگذاری تاریخچه (دُم + صفحههای قدیمیتر)،
   ساخت تنبل گفتوگو با اولین ارسال، استریم با بافر توکن (رندر حداکثر هر ۵۰ms)،
   توقف با حفظ متن نیمهکاره، پاسخ دوباره و تلاش دوباره. */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ai,
  aiErrorFrom,
  streamAsk,
  type AiError,
  type AiHistoryMessage,
  type StreamOutcome,
  type StreamStartMeta,
} from '../../lib/ai';

export type MsgStatus = 'streaming' | 'done' | 'stopped' | 'error';

export interface ChatMsg {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  at?: string | null;
  /** شمارهٔ پیام روی سرور (برای صفحهبندی رو به عقب) */
  index?: number;
  status: MsgStatus;
  error?: AiError;
  /** پیوست تصویری محلی (تحلیل تصویر؛ روی سرور ذخیره نمیشود) */
  image?: string;
  chips?: string[];
}

export const PAGE = 40;
const FLUSH_MS = 50;

let seq = 0;
const newKey = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

function fromHistory(m: AiHistoryMessage, i: number): ChatMsg {
  return {
    key: `h${m.index ?? i}`,
    role: m.role,
    text: m.text,
    at: m.at ?? null,
    index: m.index,
    status: 'done',
  };
}

export interface UseAiChatOptions {
  /** گفتوگو تازه ساخته شد (ارسال اول) */
  onCreated?: (cid: string) => void;
  onStart?: (meta: StreamStartMeta) => void;
  /** پاسخ (حتی نیمهکاره) روی سرور ذخیره شد */
  onSettled?: (cid: string, userText: string, out: StreamOutcome) => void;
}

export function useAiChat(opts: UseAiChatOptions) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<AiError | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const cidRef = useRef<string | null>(null);
  const msgsRef = useRef<ChatMsg[]>([]);
  msgsRef.current = msgs;
  const abortRef = useRef<AbortController | null>(null);
  const bufRef = useRef('');
  const timerRef = useRef(0);
  const liveKeyRef = useRef('');

  const patch = useCallback((key: string, p: Partial<ChatMsg>) => {
    setMsgs((prev) => prev.map((m) => (m.key === key ? { ...m, ...p } : m)));
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = 0;
    const chunk = bufRef.current;
    if (!chunk) return;
    bufRef.current = '';
    const key = liveKeyRef.current;
    setMsgs((prev) => prev.map((m) => (m.key === key ? { ...m, text: m.text + chunk } : m)));
  }, []);

  const onToken = useCallback(
    (t: string) => {
      bufRef.current += t;
      if (!timerRef.current) timerRef.current = window.setTimeout(flush, FLUSH_MS);
    },
    [flush],
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const stream = useCallback(
    async (text: string, cid: string, key: string, regenerate: boolean) => {
      const ctl = new AbortController();
      abortRef.current = ctl;
      liveKeyRef.current = key;
      bufRef.current = '';
      setStreaming(true);
      const out = await streamAsk(text, {
        conversationId: cid,
        regenerate,
        signal: ctl.signal,
        onStart: (meta) => optsRef.current.onStart?.(meta),
        onToken,
      });
      flush();
      if (abortRef.current === ctl) {
        abortRef.current = null;
        setStreaming(false);
      }
      patch(key, {
        status: out.status === 'done' ? 'done' : out.status === 'aborted' ? 'stopped' : 'error',
        error: out.status === 'error' ? out.error : undefined,
      });
      if (cidRef.current === cid) optsRef.current.onSettled?.(cid, text, out);
      return out;
    },
    [flush, onToken, patch],
  );

  /** ساخت تنبل: گفتوگوی خالی فقط وقتی ساخته میشود که پیامی فرستاده شود. */
  const ensureCid = useCallback(async (assistantKey: string): Promise<string | null> => {
    if (cidRef.current) return cidRef.current;
    try {
      const r = await ai.createConversation();
      cidRef.current = r.id;
      optsRef.current.onCreated?.(r.id);
      return r.id;
    } catch (e) {
      patch(assistantKey, { status: 'error', error: aiErrorFrom(e) });
      return null;
    }
  }, [patch]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || abortRef.current) return false;
      const now = new Date().toISOString();
      const aKey = newKey('a');
      setMsgs((prev) => [
        ...prev,
        { key: newKey('u'), role: 'user', text, at: now, status: 'done' },
        { key: aKey, role: 'assistant', text: '', at: now, status: 'streaming' },
      ]);
      const cid = await ensureCid(aKey);
      if (!cid) return true;
      await stream(text, cid, aKey, false);
      return true;
    },
    [ensureCid, stream],
  );

  /** پاسخ دوباره/تلاش دوباره برای یک پیام دستیار (فقط آخرین). */
  const regenerate = useCallback(
    async (key: string) => {
      if (abortRef.current) return;
      const list = msgsRef.current;
      const i = list.findIndex((m) => m.key === key);
      if (i < 0) return;
      const user = [...list.slice(0, i)].reverse().find((m) => m.role === 'user');
      if (!user) return;
      patch(key, { text: '', status: 'streaming', error: undefined, at: new Date().toISOString() });
      const cid = await ensureCid(key);
      if (!cid) return;
      await stream(user.text, cid, key, true);
    },
    [ensureCid, patch, stream],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const load = useCallback(async (cid: string | null) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    cidRef.current = cid;
    setLoadError(null);
    setHasMore(false);
    setMsgs([]);
    if (!cid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await ai.messages(cid, { limit: PAGE });
      if (cidRef.current !== cid) return;
      setMsgs((r.messages || []).map(fromHistory));
      setHasMore(Boolean(r.has_more));
    } catch (e) {
      if (cidRef.current === cid) setLoadError(aiErrorFrom(e));
    } finally {
      if (cidRef.current === cid) setLoading(false);
    }
  }, []);

  const loadOlder = useCallback(async () => {
    const cid = cidRef.current;
    const first = msgsRef.current[0];
    if (!cid || first?.index === undefined || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const r = await ai.messages(cid, { before: first.index, limit: PAGE });
      if (cidRef.current !== cid) return;
      setMsgs((prev) => [...(r.messages || []).map(fromHistory), ...prev]);
      setHasMore(Boolean(r.has_more));
    } catch {
      /* دکمه دوباره قابل زدن است */
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder]);

  const append = useCallback((items: Array<Omit<ChatMsg, 'key'>>) => {
    setMsgs((prev) => [...prev, ...items.map((m) => ({ ...m, key: newKey(m.role[0]) }))]);
  }, []);

  return {
    msgs,
    streaming,
    loading,
    loadError,
    hasMore,
    loadingOlder,
    cid: () => cidRef.current,
    send,
    regenerate,
    stop,
    load,
    loadOlder,
    append,
  };
}
