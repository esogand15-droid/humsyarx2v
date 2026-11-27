import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../icons';
import type { IconName } from '../../icons/sprite';
import { streamAiChat, type AiMessage } from '../../lib/ai';
import { faNum } from '../../lib/fa';

interface Props {
  fileId: string;
  bookletName?: string;
  page?: number;
  onClose?: () => void;
}

const PRESET_PROMPTS: ReadonlyArray<{ icon: IconName; text: string }> = [
  { icon: 'i-stethoscope', text: 'نکات بالینی و تشخیصی کلیدی این جزوه چیست؟' },
  { icon: 'i-zap', text: 'این مبحث را در چند نکته طلایی برای آزمون خلاصه کن.' },
  { icon: 'i-file-text', text: '۳ تست تالیفی استاندارد با پاسخ تشریحی از این بخش طراحی کن.' },
  { icon: 'i-pill', text: 'نکات فارماکولوژی، دوزاژ و تشخیص‌های افتراقی این مبحث چیست؟' },
];

export function EmbeddedAiStudyPanel({ fileId, bookletName, page, onClose }: Props) {
  void onClose;
  const welcomeForContext = (name?: string, pg?: number) =>
    `سلام! من هوشیار هستم؛ همکار هوشمند مطالعهٔ شما در پلتفرم هامزیار.\nدر حال حاضر جزوهٔ «${name || 'این بخش'}»${pg ? ` (صفحهٔ ${faNum(pg)})` : ''} را مرور می‌کنید. هر سؤالی پیرامون فارماکولوژی، پاتوفیزیولوژی، تشخیص‌های افتراقی، یا تفسیر ECG دارید بپرسید تا با شواهد علمی پاسخ دهم.`;

  const [messages, setMessages] = useState<AiMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: welcomeForContext(bookletName, page),
      timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<number>(0);

  useEffect(() => {
    setMessages((prev) =>
      prev.length === 1 && prev[0].id === 'welcome'
        ? [{ ...prev[0], text: welcomeForContext(bookletName, page) }]
        : prev,
    );
  }, [bookletName, page]);

  useEffect(() => () => {
    abortRef.current?.abort();
    window.clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleReset = () => {
    abortRef.current?.abort();
    setLoading(false);
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        text: welcomeForContext(bookletName, page),
        timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setInput('');
  };

  const handleCopy = (id: string, text: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedId(id);
    window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSend = async (customPrompt?: string) => {
    const textToSend = customPrompt || input.trim();
    if (!textToSend || loading) return;

    if (!customPrompt) setInput('');
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const contextHeader = `[زمینه مطالعه در کتابخوان — فایل: ${fileId}${bookletName ? ` | جزوه: «${bookletName}»` : ''}${page ? ` | صفحه: ${page}` : ''}]\n`;
    const promptWithContext = `${contextHeader}${textToSend}`;

    const userMsg: AiMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
    };

    const aiMsgId = `ai_${Date.now()}`;
    const initialAiMsg: AiMessage = {
      id: aiMsgId,
      role: 'assistant',
      text: '',
      timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg, initialAiMsg]);
    setLoading(true);

    try {
      await streamAiChat(
        promptWithContext,
        null,
        {
          onToken: (token) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === aiMsgId ? { ...m, text: m.text + token } : m)),
            );
          },
          onDone: (tokens) => {
            setLoading(false);
            setMessages((prev) =>
              prev.map((m) => (m.id === aiMsgId ? { ...m, tokens_used: tokens } : m)),
            );
          },
          onError: () => {
            setLoading(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMsgId && !m.text
                  ? {
                      ...m,
                      text: 'پاسخ هوش‌یار در دسترس نیست. لطفاً اتصال اینترنت خود را بررسی و دوباره تلاش کنید.',
                    }
                  : m,
              ),
            );
          },
        },
        ac.signal,
      );
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="embedded-ai-panel">
      {/* پیام‌ها */}
      <div ref={scrollRef} className="embedded-ai-messages">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`embedded-ai-bubble embedded-ai-bubble--${m.role}`}
          >
            <div className="embedded-ai-bubble-header">
              {m.role === 'assistant' ? (
                <div className="embedded-ai-sender-tag">
                  <span className="embedded-ai-pulse-dot" />
                  <span className="embedded-ai-sender-name">هوشیار</span>
                </div>
              ) : (
                <span className="embedded-ai-user-tag">پرسش شما</span>
              )}
              {m.role === 'assistant' && m.text && (
                <button
                  type="button"
                  className="embedded-ai-copy-btn"
                  onClick={() => handleCopy(m.id, m.text)}
                  title="کپی پاسخ"
                >
                  <Icon name={copiedId === m.id ? 'i-check' : 'i-copy'} size={12} />
                  <span>{copiedId === m.id ? 'کپی شد' : 'کپی'}</span>
                </button>
              )}
            </div>
            <div className="embedded-ai-text">
              {m.text || (loading && m.role === 'assistant' ? 'در حال نگارش پاسخ بالینی…' : '')}
            </div>
            <span className="embedded-ai-time num">
              {m.timestamp}
            </span>
          </div>
        ))}
        {loading && (
          <div className="embedded-ai-typing">
            <span className="ai-typing-dot" />
            <span className="ai-typing-dot" />
            <span className="ai-typing-dot" />
            <span className="embedded-ai-typing-label">در حال جستجو و تحلیل بالینی مبحث…</span>
          </div>
        )}
      </div>

      {/* پیشنهادهای سریع و ابزار */}
      <div className="embedded-ai-chips">
        <button
          type="button"
          className="embedded-ai-chip embedded-ai-reset"
          onClick={handleReset}
          title="شروع گفتگوی تازه"
        >
          <Icon name="i-refresh" size={14} />
          <span>گفتگوی تازه</span>
        </button>
        {PRESET_PROMPTS.map((prompt) => (
          <button
            key={prompt.text}
            type="button"
            className="embedded-ai-chip"
            onClick={() => void handleSend(prompt.text)}
          >
            <Icon name={prompt.icon} size={14} />
            <span>{prompt.text}</span>
          </button>
        ))}
      </div>

      {/* ورودی متن با طراحی شیشه‌ای مدرن */}
      <div className="embedded-ai-input-wrap">
        <input
          type="text"
          className="embedded-ai-input"
          placeholder="سؤال بالینی خود از این مبحث را بپرسید…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          disabled={loading}
        />
        <button
          type="button"
          className="embedded-ai-send-btn"
          onClick={() => void handleSend()}
          disabled={loading || !input.trim()}
          aria-label="ارسال سؤال"
          title="ارسال سؤال (Enter)"
        >
          <Icon name="i-send" size={17} />
        </button>
      </div>
    </div>
  );
}
