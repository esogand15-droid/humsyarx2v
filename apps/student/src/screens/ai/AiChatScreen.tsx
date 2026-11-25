import { useState, useRef, useEffect, useCallback } from 'react';
import { AppBar } from '../../components/AppBar';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { Icon } from '../../icons';
import { streamAiChat, type AiMessage, type VisionDiagnosisResult } from '../../lib/ai';
import { AiVisionModal } from './AiVisionModal';

const SUGGESTIONS = [
  'توضیح پاتوفیزیولوژی شوک سپتیک و مراحل درمانی',
  'تفسیر تغییرات قطعه ST و موج T در نوار قلب (ECG)',
  'مرور درمان مرحله‌ای پرفشاری خون مطابق آخرین گایدلاین',
  'تشخیص‌های افتراقی درد حاد شکم در ربع تحتانی راست',
];

export function AiChatScreen() {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showVisionModal, setShowVisionModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming, scrollToBottom]);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || isStreaming) return;

    setError(null);
    setInput('');

    const userMsgId = `user_${Date.now()}`;
    const assistantMsgId = `assistant_${Date.now()}`;

    const userMsg: AiMessage = {
      id: userMsgId,
      role: 'user',
      text,
      timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
    };

    const initialAssistantMsg: AiMessage = {
      id: assistantMsgId,
      role: 'assistant',
      text: '',
      timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg, initialAssistantMsg]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await streamAiChat(
        text,
        null,
        {
          onToken: (token: string) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId ? { ...msg, text: msg.text + token } : msg,
              ),
            );
          },
          onDone: (tokensUsed: number) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId ? { ...msg, tokens_used: tokensUsed } : msg,
              ),
            );
          },
          onError: (err: Error) => {
            setError(err.message || 'خطا در دریافت پاسخ از هوش‌یار');
          },
        },
        controller.signal,
      );
    } catch {
      // already reported in onError
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  };

  const handleVisionApplied = (result: VisionDiagnosisResult, imageUrl: string, promptText: string) => {
    const visionUserMsg: AiMessage = {
      id: `user_vision_${Date.now()}`,
      role: 'user',
      text: promptText,
      timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
      vision: { image_url: imageUrl },
    };

    const visionAssistantMsg: AiMessage = {
      id: `assistant_vision_${Date.now()}`,
      role: 'assistant',
      text: result.analysis,
      timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
      tokens_used: result.tokens_used,
      vision: {
        detected_structures: result.detected_structures,
        confidence_level: result.confidence_level,
      },
    };

    setMessages((prev) => [...prev, visionUserMsg, visionAssistantMsg]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <>
      <AppBar
        title="هوش‌یار پزشکی"
        sub="دستیار هوشمند و تحلیل بالینی"
        actions={
          <div className="row gap-8">
            <button
              type="button"
              className="iconbtn"
              onClick={() => setShowVisionModal(true)}
              title="تحلیل تصویر بالینی (Vision)"
              aria-label="تحلیل تصویر بالینی"
            >
              <Icon name="i-upload" size={18} />
            </button>
            <button
              type="button"
              className="iconbtn"
              onClick={() => {
                if (isStreaming) handleStop();
                setMessages([]);
                setError(null);
              }}
              title="گفت‌وگوی تازه"
              aria-label="گفت‌وگوی تازه"
            >
              <Icon name="i-chat" size={18} />
            </button>
          </div>
        }
      />

      <div
        className="page"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 120px)',
          paddingBottom: 0,
        }}
      >
        {/* پیام‌های چت */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 0 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', margin: 'auto 0', padding: '24px 12px' }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.2), rgba(0, 242, 254, 0.2))',
                  border: '1px solid rgba(0, 242, 254, 0.3)',
                  display: 'grid',
                  placeItems: 'center',
                  margin: '0 auto 16px',
                  boxShadow: '0 0 24px -4px rgba(0, 242, 254, 0.3)',
                }}
              >
                <Icon name="logo-mark" size={32} />
              </div>
              <h2 className="h2" style={{ fontSize: 18, marginBottom: 8 }}>
                سلام! من هوش‌یار، دستیار هوش مصنوعی پزشکی هستم
              </h2>
              <p className="small color-muted" style={{ maxWidth: 440, margin: '0 auto 24px' }}>
                می‌توانی درباره مباحث علوم پایه، بالینی، فارماکولوژی، تفسیر آزمایش‌ها و تحلیل تصاویر تشخیصی از من بپرسی.
              </p>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  maxWidth: 480,
                  margin: '0 auto',
                  textAlign: 'right',
                }}
              >
                {SUGGESTIONS.map((sug, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => void handleSend(sug)}
                    className="card card--glass"
                    style={{
                      padding: '12px 16px',
                      cursor: 'pointer',
                      fontSize: 13.5,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      textAlign: 'right',
                      transition: 'all var(--t-fast) ease',
                    }}
                  >
                    <Icon name="i-flask" size={16} />
                    <span className="grow">{sug}</span>
                    <Icon name="i-chevron" size={16} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-start' : 'flex-end',
                    maxWidth: '85%',
                    alignSelf: isUser ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div
                    className={isUser ? 'card' : 'card card--glass'}
                    style={{
                      background: isUser
                        ? 'linear-gradient(135deg, var(--hym-brand-700), var(--hym-brand-600))'
                        : undefined,
                      color: isUser ? '#FFFFFF' : 'var(--ink)',
                      border: isUser ? 'none' : '1px solid var(--line)',
                      borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      padding: '12px 16px',
                      boxShadow: 'var(--sh-1)',
                      wordBreak: 'break-word',
                    }}
                  >
                    {msg.vision?.image_url && (
                      <div className="mb-10">
                        <img
                          src={msg.vision.image_url}
                          alt="پیوست تصویر پزشکی"
                          style={{
                            maxHeight: 180,
                            borderRadius: 8,
                            objectFit: 'contain',
                            display: 'block',
                          }}
                        />
                      </div>
                    )}

                    <div
                      style={{
                        fontSize: 14.5,
                        lineHeight: 1.8,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {msg.text}
                      {msg.role === 'assistant' && !msg.text && isStreaming && (
                        <span className="typing-cursor" style={{ opacity: 0.8 }}>▍ در حال نگارش…</span>
                      )}
                    </div>

                    {msg.vision?.detected_structures && msg.vision.detected_structures.length > 0 && (
                      <div className="mt-8 pt-8" style={{ borderTop: '1px solid var(--line)' }}>
                        <div className="row gap-4" style={{ flexWrap: 'wrap' }}>
                          {msg.vision.detected_structures.map((s, idx) => (
                            <Chip key={idx} variant="quiet">{s}</Chip>
                          ))}
                        </div>
                      </div>
                    )}

                    <div
                      className="row row--between mt-6"
                      style={{
                        fontSize: 10,
                        opacity: 0.7,
                        alignItems: 'center',
                        direction: 'ltr',
                      }}
                    >
                      <span>{msg.timestamp}</span>
                      {msg.tokens_used ? <span>{msg.tokens_used} tokens</span> : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {error && (
            <Card
              className="mt-8"
              style={{
                background: 'var(--danger-soft)',
                borderColor: 'var(--danger)',
                color: 'var(--danger)',
                padding: '10px 14px',
              }}
            >
              <div className="row gap-8" style={{ alignItems: 'center' }}>
                <Icon name="i-alert-circle" size={18} />
                <span className="small">{error}</span>
              </div>
            </Card>
          )}

          <div ref={chatBottomRef} />
        </div>

        {/* ناحیه ورودی پیام */}
        <div
          style={{
            borderTop: '1px solid var(--line)',
            padding: '10px 0 16px',
            background: 'var(--paper)',
          }}
        >
          <div
            className="row gap-8"
            style={{
              alignItems: 'flex-end',
              background: 'var(--paper-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-lg)',
              padding: '6px 10px',
            }}
          >
            <button
              type="button"
              className="iconbtn"
              style={{ width: 34, height: 34, border: 'none', background: 'transparent' }}
              onClick={() => setShowVisionModal(true)}
              title="بارگذاری تصویر بالینی (Vision)"
              aria-label="بارگذاری تصویر بالینی"
            >
              <Icon name="i-upload" size={20} />
            </button>

            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="سؤال پزشکی یا بالینی خود را بنویسید…"
              disabled={isStreaming}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                resize: 'none',
                padding: '6px 4px',
                fontSize: 'var(--hym-fs-input)',
                lineHeight: 1.5,
                outline: 'none',
                color: 'var(--ink)',
                maxHeight: 120,
              }}
            />

            {isStreaming ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleStop}
                style={{ padding: '6px 12px', color: 'var(--danger)' }}
              >
                توقف
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleSend()}
                disabled={!input.trim()}
                style={{ padding: '6px 16px' }}
              >
                ارسال
              </Button>
            )}
          </div>
        </div>
      </div>

      <AiVisionModal
        open={showVisionModal}
        onClose={() => setShowVisionModal(false)}
        onApplyToChat={handleVisionApplied}
      />
    </>
  );
}
