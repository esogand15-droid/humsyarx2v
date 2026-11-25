import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppBar } from '../components/AppBar';
import { ErrorBlock, LoadingBlock } from '../components/AccessStates';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { Input } from '../components/Input';
import { errorText } from '../lib/api';
import { fa } from '../lib/library';
import {
  STATUS_LABEL,
  TICKET_MIN_MESSAGE,
  statusTone,
  ticketTime,
  tickets as ticketsApi,
  type TicketDetail,
  type TicketMessage,
  type TicketSummary,
} from '../lib/tickets';

/** Support tickets: real data from /api/web/tickets (the same tickets the bot and admin panel see).
    It used to ship a hardcoded fake conversation and kept new tickets only in
    component state; they never reached support. */
export function TicketsScreen() {
  const [list, setList] = useState<TicketSummary[] | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [listError, setListError] = useState<unknown>(null);

  const [showNewTicket, setShowNewTicket] = useState(false);
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // TK2: the open ticket lives in the URL (/tickets/:id), so refresh, back and deep links work.
  const { id: idParam } = useParams();
  const navigate = useNavigate();
  const parsedId = idParam != null && /^\d+$/.test(idParam) ? Number(idParam) : null;
  const selectedId = parsedId;
  const badParam = idParam != null && parsedId == null;
  const setSelectedId = useCallback(
    (id: number | null) => navigate(id == null ? '/tickets' : `/tickets/${id}`),
    [navigate],
  );
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState('');

  const loadList = useCallback(async () => {
    setListError(null);
    try {
      const res = await ticketsApi.list();
      setList(res.tickets || []);
      setSubjects(res.subjects || []);
    } catch (err) {
      setListError(err);
    }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setDetailError(null);
    try {
      const res = await ticketsApi.get(id);
      if (!res?.ticket) throw new Error('ticket missing');
      setDetail(res.ticket);
    } catch (err) {
      setDetailError(err);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Old in-app links (/tickets?t=123) land on the detail route.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t');
    if (idParam == null && t && /^\d+$/.test(t)) navigate(`/tickets/${t}`, { replace: true });
  }, [idParam, navigate]);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    setDetail(null);
    setReplyText('');
    setReplyError('');
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = subject.trim();
    const m = message.trim();
    if (!s || !m || creating) return;
    if (m.length < TICKET_MIN_MESSAGE) {
      setCreateError(`متن پیام باید دست‌کم ${fa(TICKET_MIN_MESSAGE)} حرف باشد.`);
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      const fullSubject = category ? `${category} · ${s}` : s;
      const res = await ticketsApi.create(fullSubject, m);
      setSubject('');
      setMessage('');
      setCategory('');
      setShowNewTicket(false);
      await loadList();
      if (res.ticket_id) setSelectedId(res.ticket_id);
    } catch (err) {
      setCreateError(errorText(err, 'ثبت تیکت ممکن نشد. کمی بعد دوباره تلاش کنید.'));
    } finally {
      setCreating(false);
    }
  };

  const handleSendReply = async () => {
    const text = replyText.trim();
    if (!text || !detail || sending) return;
    setSending(true);
    setReplyError('');
    try {
      await ticketsApi.reply(detail.id, text);
      setReplyText('');
      await loadDetail(detail.id);
    } catch (err) {
      setReplyError(errorText(err, 'ارسال پاسخ ممکن نشد. دوباره تلاش کنید.'));
    } finally {
      setSending(false);
    }
  };

  const messages: TicketMessage[] = detail
    ? [{ text: detail.message, sender: 'user', at: detail.created_at }, ...(detail.replies || [])]
    : [];
  const closed = detail?.status === 'closed';

  return (
    <>
      <AppBar
        title={selectedId != null ? `تیکت ${fa(selectedId)}` : 'پشتیبانی و تیکت‌ها'}
        sub="پاسخ‌گویی به سؤالات فنی و آموزشی"
        back={idParam != null}
        onBack={idParam != null ? () => setSelectedId(null) : undefined}
        actions={
          !showNewTicket && idParam == null ? (
            <Button variant="primary" size="sm" onClick={() => setShowNewTicket(true)}>
              تیکت جدید
            </Button>
          ) : undefined
        }
      />

      <div className="page">
        {badParam ? (
          <EmptyState
            icon="i-message-circle"
            title="این تیکت پیدا نشد"
            text="نشانی تیکت معتبر نیست. از فهرست تیکت‌ها یکی را انتخاب کن."
            action={
              <Button variant="primary" size="sm" onClick={() => setSelectedId(null)}>
                فهرست تیکت‌ها
              </Button>
            }
          />
        ) : selectedId != null ? (
          <div>
            {detail && (
              <div className="row mb-16">
                <Chip variant={statusTone(detail.status)}>{STATUS_LABEL[detail.status] ?? detail.status}</Chip>
              </div>
            )}

            {detailError != null ? (
              <ErrorBlock error={detailError} onRetry={() => void loadDetail(selectedId)} />
            ) : !detail ? (
              <LoadingBlock rows={3} />
            ) : (
              <>
                <Card className="card--glass mb-16">
                  <div className="h3">{detail.subject}</div>
                  <div className="tiny color-muted mt-2">
                    شناسه: {fa(detail.id)}
                    {detail.created_at ? ` · ${ticketTime(detail.created_at)}` : ''}
                  </div>
                </Card>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                  {messages.map((m, idx) => {
                    const isUser = m.sender === 'user';
                    return (
                      <div key={idx} style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                        <div
                          className="card"
                          style={{
                            background: isUser ? 'var(--brand-soft)' : 'var(--paper-2)',
                            border: isUser ? '1px solid rgba(37, 99, 235, 0.3)' : '1px solid var(--line)',
                            borderRadius: isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                            padding: '12px 14px',
                          }}
                        >
                          <div className="tiny color-muted mb-4">{isUser ? 'شما' : 'کارشناس پشتیبانی هامزیار'}</div>
                          <p className="body" style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>
                            {m.text}
                          </p>
                          {m.at && <div className="tiny color-muted mt-4">{ticketTime(m.at, true)}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {closed ? (
                  <p className="small color-muted" style={{ textAlign: 'center' }}>
                    این تیکت بسته شده است؛ برای موضوع تازه، تیکت جدید ثبت کنید.
                  </p>
                ) : (
                  <Card className="card--glass">
                    <div className="row gap-8">
                      <input
                        className="input grow"
                        placeholder="پاسخ خود را بنویسید…"
                        value={replyText}
                        disabled={sending}
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void handleSendReply()}
                      />
                      <Button variant="primary" size="sm" loading={sending} onClick={() => void handleSendReply()}>
                        ارسال
                      </Button>
                    </div>
                    {replyError && <p className="tiny mt-8" style={{ color: 'var(--danger, #dc2626)' }}>{replyError}</p>}
                  </Card>
                )}
              </>
            )}
          </div>
        ) : showNewTicket ? (
          <div>
            <div className="row row--between mb-16" style={{ alignItems: 'center' }}>
              <span className="h3">ارسال درخواست جدید</span>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setShowNewTicket(false)}>
                انصراف
              </button>
            </div>

            <Card className="card--glass">
              <form onSubmit={(e) => void handleCreateTicket(e)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {subjects.length > 0 && (
                    <div>
                      <label className="tiny color-muted" style={{ display: 'block', marginBottom: 6 }}>
                        دسته‌بندی:
                      </label>
                      <select
                        className="input"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        style={{ width: '100%', height: 42 }}
                      >
                        <option value="">انتخاب کنید (اختیاری)</option>
                        {subjects.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <Input
                    label="موضوع درخواست"
                    placeholder="مثال: مشکل در باز شدن فایل کتابخوان"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    required
                  />

                  <div>
                    <label className="tiny color-muted" style={{ display: 'block', marginBottom: 6 }}>
                      متن پیام:
                    </label>
                    <textarea
                      className="input"
                      rows={4}
                      placeholder="توضیحات کامل مشکل یا درخواست خود را بنویسید…"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      required
                      style={{ width: '100%', resize: 'vertical' }}
                    />
                  </div>

                  {createError && <p className="tiny" style={{ color: 'var(--danger, #dc2626)' }}>{createError}</p>}

                  <div className="mt-8">
                    <Button type="submit" variant="primary" block loading={creating}>
                      ثبت و ارسال تیکت
                    </Button>
                  </div>
                </div>
              </form>
            </Card>
          </div>
        ) : listError != null ? (
          <ErrorBlock error={listError} onRetry={() => void loadList()} />
        ) : list == null ? (
          <LoadingBlock rows={3} />
        ) : list.length === 0 ? (
          <div className="mt-20">
            <EmptyState
              icon="i-message-circle"
              title="تیکتی ثبت نشده است"
              text="در صورت نیاز به راهنمایی یا گزارش مشکل، تیکت جدید ارسال کنید."
              action={
                <Button variant="primary" size="sm" onClick={() => setShowNewTicket(true)}>
                  ارسال تیکت جدید
                </Button>
              }
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {list.map((t) => (
              <Card
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className="card--glass"
                style={{ cursor: 'pointer', padding: '14px 16px' }}
              >
                <div className="row row--between" style={{ alignItems: 'center' }}>
                  <span className="h3" style={{ fontSize: 14.5 }}>
                    {t.subject}
                  </span>
                  <Chip variant={statusTone(t.status)}>{STATUS_LABEL[t.status] ?? t.status}</Chip>
                </div>
                <div className="row row--between mt-8">
                  <span className="tiny color-muted">
                    #{fa(t.id)}
                    {t.reply_count > 0 ? ` · ${fa(t.reply_count)} پاسخ` : ''}
                  </span>
                  <span className="tiny color-muted">{ticketTime(t.created_at)}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
