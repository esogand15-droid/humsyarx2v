/* لایه داده هوش‌یار پزشکی (Wave 6 Features 33 & 34) */
import { apiCall } from './api';

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  tokens_used?: number;
  vision?: {
    image_url?: string;
    detected_structures?: string[];
    confidence_level?: string;
  };
}

export interface AiConversation {
  id: string;
  title: string;
  preview?: string;
  created_at?: string;
  updated_at?: string;
}

export interface VisionDiagnosisResult {
  analysis: string;
  detected_structures: string[];
  confidence_level: string;
  tokens_used: number;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone?: (tokensUsed: number) => void;
  onError?: (error: Error) => void;
}

/** استریم توکن‌های هوش‌یار با Server-Sent Events (SSE) */
export async function streamAiChat(
  message: string,
  conversationId: string | null | undefined,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const url = '/api/ai/ask';
  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        message,
        conversation_id: conversationId || undefined,
      }),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = 'خطا در ارتباط با هوش‌یار';
      try {
        const parsed = JSON.parse(errText);
        msg = parsed.detail?.message || parsed.detail || msg;
      } catch {
        // fallback
      }
      throw new Error(msg);
    }

    if (!res.body) {
      throw new Error('پاسخی از سرور دریافت نشد');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      let currentEvent = '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          currentEvent = '';
          continue;
        }

        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim();
        } else if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          try {
            const data = JSON.parse(dataStr);
            if (currentEvent === 'token' && typeof data.text === 'string') {
              callbacks.onToken(data.text);
            } else if (currentEvent === 'done') {
              const tokens = typeof data.tokens_used === 'number' ? data.tokens_used : 0;
              callbacks.onDone?.(tokens);
            }
          } catch {
            // Not valid JSON yet or partial data
          }
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    const errorObj = err instanceof Error ? err : new Error(String(err));
    callbacks.onError?.(errorObj);
    throw errorObj;
  }
}

/** تحلیل بالینی و تشخیصی تصویر پزشکی (مولتی‌مدال) */
export async function diagnoseClinicalImage(
  file: File,
  prompt?: string,
): Promise<VisionDiagnosisResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (prompt) {
    formData.append('prompt', prompt);
  }

  try {
    const res = await fetch('/api/ai/vision', {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = 'خطا در تحلیل تصویر پزشکی';
      try {
        const parsed = JSON.parse(errText);
        msg = parsed.detail?.message || parsed.detail || msg;
      } catch {
        // fallback
      }
      throw new Error(msg);
    }

    return (await res.json()) as VisionDiagnosisResult;
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    throw errorObj;
  }
}

export const ai = {
  stream: streamAiChat,
  vision: diagnoseClinicalImage,
  conversations: () =>
    apiCall<{ conversations: AiConversation[] }>('/api/ai/conversations').catch(() => ({
      conversations: [],
    })),
};
