import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import './account.css';
import { AppBar } from '../components/AppBar';
import { ErrorBlock, LoadingBlock } from '../components/AccessStates';
import { DsBadge, DsButton, DsCard, DsEmpty, DsInput } from '../design/components';
import { Icon } from '../icons';
import { errorText } from '../lib/api';
import { faNum } from '../lib/fa';
import {
  STATUS_LABEL,
  TICKET_MIN_MESSAGE,
  ticketTime,
  tickets as ticketsApi,
  type TicketDetail,
  type TicketMessage,
  type TicketStatus,
  type TicketSummary,
} from '../lib/tickets';

function ticketBadgeTone(status: TicketStatus): 'accent' | 'success' | 'neutral' {
  if (status === 'waiting_user') return 'success';
  if (status === 'resolved' || status === 'closed') return 'neutral';
  return 'accent';
}

/** پشتیبانی و تیکت‌ها — مسیر عمیق `/tickets/:id` + اینباکس دوتایی در دسکتاپ (TK1, TK2, D1). */
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

  const openNewTicketForm = () => {
    setShowNewTicket(true);
    if (selectedId != null) setSelectedId(null);
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = subject.trim();
    const m = message.trim();
    if (!s || !m || creating) return;
    if (m.length < TICKET_MIN_MESSAGE) {
      setCreateError(`متن پیام باید دست‌کم ${faNum(TICKET_MIN_MESSAGE)} حرف باشد.`);
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
  const mobileDetailActive = showNewTicket || selectedId != null || badParam;

  return (
    <>
      <AppBar
        title={selectedId != null ? `تیکت ${faNum(selectedId)}` : 'پشتیبانی و تیکت‌ها'}
        sub="پشتیبانی فنی و آموزشی"
        back={idParam != null || showNewTicket}
        onBack={
          idParam != null
            ? () => setSelectedId(null)
            : showNewTicket
              ? () => setShowNewTicket(false)
              : undefined
        }
        actions={
          !showNewTicket ? (
            <DsButton
              variant="primary"
              size="sm"
              className="acct-btn-tall"
              onClick={openNewTicketForm}
            >
              تیکت جدید
            </DsButton>
          ) : undefined
        }
      />

      <div className="page page-enter acct-page">
        <div className={`acct-tickets-split${mobileDetailActive ? ' is-detail-open' : ''}`}>
          {/* ستون فهرست تیکت‌ها */}
          <aside className="acct-tickets-list-pane" aria-label="فهرست تیکت‌ها">
            <div className="acct-sec-head">
              <h2 className="acct-sec-head__title">تیکت‌های شما</h2>
              {list && <span className="acct-sec-head__sub">{faNum(list.length)} مورد</span>}
            </div>

            {listError != null ? (
              <ErrorBlock error={listError} onRetry={() => void loadList()} />
            ) : list == null ? (
              <LoadingBlock rows={3} />
            ) : list.length === 0 ? (
              <DsCard>
                <DsEmpty
                  icon={<Icon name="i-message-circle" size={28} />}
                  title="تیکتی ثبت نشده است"
                  body="در صورت نیاز به راهنمایی یا گزارش مشکل، تیکت جدید ارسال کنید."
                  action={
                    <DsButton variant="primary" size="md" onClick={openNewTicketForm}>
                      ارسال تیکت جدید
                    </DsButton>
                  }
                />
              </DsCard>
            ) : (
              <div className="acct-ticket-list">
                {list.map((t) => {
                  const isActive = selectedId === t.id && !showNewTicket;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`acct-ticket-item${isActive ? ' is-active' : ''}`}
                      onClick={() => {
                        setShowNewTicket(false);
                        setSelectedId(t.id);
                      }}
                    >
                      <div className="acct-ticket-item__top">
                        <span className="acct-ticket-item__subject">{t.subject}</span>
                        <DsBadge tone={ticketBadgeTone(t.status)}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </DsBadge>
                      </div>
                      <div className="acct-ticket-item__meta">
                        <span>
                          تیکت {faNum(t.id)}
                          {t.reply_count > 0 ? ` · ${faNum(t.reply_count)} پاسخ` : ''}
                        </span>
                        <span>{ticketTime(t.created_at)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          {/* ستون گفتگو یا فرم تیکت جدید */}
          <section className="acct-tickets-detail-pane" aria-label="جزئیات تیکت">
            {badParam ? (
              <DsCard>
                <DsEmpty
                  icon={<Icon name="i-message-circle" size={28} />}
                  title="این تیکت پیدا نشد"
                  body="نشانی تیکت معتبر نیست. از فهرست تیکت‌ها یکی را انتخاب کنید."
                  action={
                    <DsButton variant="primary" size="md" onClick={() => setSelectedId(null)}>
                      فهرست تیکت‌ها
                    </DsButton>
                  }
                />
              </DsCard>
            ) : showNewTicket ? (
              <DsCard className="acct-card-stack">
                <div className="acct-sec-head">
                  <h2 className="acct-sec-head__title">ارسال درخواست جدید</h2>
                  <DsButton
                    variant="ghost"
                    size="sm"
                    className="acct-btn-tall"
                    onClick={() => setShowNewTicket(false)}
                  >
                    انصراف
                  </DsButton>
                </div>

                <form className="acct-form-stack" onSubmit={(e) => void handleCreateTicket(e)}>
                  {subjects.length > 0 && (
                    <div className="ds-field">
                      <label className="ds-field__label" htmlFor="ticket-category">
                        دسته‌بندی
                      </label>
                      <select
                        id="ticket-category"
                        className="ds-input"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
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

                  <DsInput
                    name="ticket-subject"
                    label="موضوع درخواست"
                    placeholder="مثال: مشکل در باز شدن فایل کتابخوان"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    required
                  />

                  <div className="ds-field">
                    <label className="ds-field__label" htmlFor="ticket-message">
                      متن پیام
                    </label>
                    <textarea
                      id="ticket-message"
                      className="ds-input acct-textarea"
                      rows={4}
                      placeholder="توضیحات کامل مشکل یا درخواست خود را بنویسید…"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      required
                    />
                  </div>

                  {createError && (
                    <p className="ds-field__error" role="alert">
                      {createError}
                    </p>
                  )}

                  <DsButton type="submit" variant="primary" size="lg" block loading={creating}>
                    ثبت و ارسال تیکت
                  </DsButton>
                </form>
              </DsCard>
            ) : selectedId != null ? (
              detailError != null ? (
                <ErrorBlock error={detailError} onRetry={() => void loadDetail(selectedId)} />
              ) : !detail ? (
                <LoadingBlock rows={3} />
              ) : (
                <div className="acct-stack">
                  <DsCard className="acct-card-stack">
                    <div className="acct-sec-head">
                      <h2 className="acct-sec-head__title">{detail.subject}</h2>
                      <DsBadge tone={ticketBadgeTone(detail.status)}>
                        {STATUS_LABEL[detail.status] ?? detail.status}
                      </DsBadge>
                    </div>
                    <span className="acct-sec-head__sub">
                      تیکت {faNum(detail.id)}
                      {detail.created_at ? ` · ${ticketTime(detail.created_at)}` : ''}
                    </span>
                  </DsCard>

                  <div className="acct-thread">
                    {messages.map((m, idx) => {
                      const isUser = m.sender === 'user';
                      return (
                        <div
                          key={idx}
                          className={`acct-msg ${isUser ? 'acct-msg--user' : 'acct-msg--support'}`}
                        >
                          <span className="acct-msg__sender">
                            {isUser ? 'شما' : 'کارشناس پشتیبانی هامزیار'}
                          </span>
                          <p className="acct-msg__text">{m.text}</p>
                          {m.at && <span className="acct-msg__time">{ticketTime(m.at, true)}</span>}
                        </div>
                      );
                    })}
                  </div>

                  {closed ? (
                    <DsCard level="sunken">
                      <p className="acct-closed-note">
                        این تیکت بسته شده است؛ برای موضوع تازه، تیکت جدید ثبت کنید.
                      </p>
                    </DsCard>
                  ) : (
                    <DsCard className="acct-card-stack">
                      <div className="acct-reply-bar">
                        <input
                          type="text"
                          className="ds-input acct-reply-bar__input"
                          placeholder="پاسخ خود را بنویسید…"
                          aria-label="پاسخ به تیکت"
                          value={replyText}
                          disabled={sending}
                          onChange={(e) => setReplyText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && void handleSendReply()}
                        />
                        <DsButton
                          variant="primary"
                          size="md"
                          className="acct-btn-tall"
                          loading={sending}
                          onClick={() => void handleSendReply()}
                        >
                          <Icon name="i-send" size={16} />
                          <span>ارسال</span>
                        </DsButton>
                      </div>
                      {replyError && (
                        <p className="ds-field__error" role="alert">
                          {replyError}
                        </p>
                      )}
                    </DsCard>
                  )}
                </div>
              )
            ) : (
              <DsCard>
                <DsEmpty
                  icon={<Icon name="i-message-circle" size={28} />}
                  title="یک تیکت را انتخاب کنید"
                  body="برای مشاهدهٔ گفتگو از فهرست سمت راست یک تیکت را انتخاب کنید یا درخواست جدید بفرستید."
                  action={
                    <DsButton variant="primary" size="md" onClick={openNewTicketForm}>
                      تیکت جدید
                    </DsButton>
                  }
                />
              </DsCard>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
