import { useState } from 'react';
import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { Input } from '../components/Input';
import { Icon } from '../icons';

interface Ticket {
  id: string;
  subject: string;
  department: string;
  status: 'open' | 'answered' | 'closed';
  date: string;
  messages: { sender: 'user' | 'support'; text: string; time: string }[];
}

const INITIAL_TICKETS: Ticket[] = [
  {
    id: 't-104',
    subject: 'راهنمایی در مورد آزمون‌های مبحثی فیزیولوژی',
    department: 'پشتیبانی آموزشی',
    status: 'answered',
    date: 'امروز',
    messages: [
      {
        sender: 'user',
        text: 'سلام، آیا امکان ایجاد آزمون فقط از تست‌های سال‌های ۹۸ به بعد وجود دارد؟',
        time: '۱۱:۰۰',
      },
      {
        sender: 'support',
        text: 'سلام دانشجو گرامی، بله در بخش تنظیمات آزمون می‌توانید فیلتر سال را اعمال فرمایید.',
        time: '۱۱:۲۵',
      },
    ],
  },
];

export function TicketsScreen() {
  const [tickets, setTickets] = useState<Ticket[]>(INITIAL_TICKETS);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [subject, setSubject] = useState('');
  const [department, setDepartment] = useState('آموزشی');
  const [message, setMessage] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [replyText, setReplyText] = useState('');

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    const newT: Ticket = {
      id: `t-${Date.now().toString().slice(-4)}`,
      subject: subject.trim(),
      department,
      status: 'open',
      date: 'لحظاتی پیش',
      messages: [{ sender: 'user', text: message.trim(), time: 'همین الان' }],
    };

    setTickets([newT, ...tickets]);
    setSubject('');
    setMessage('');
    setShowNewTicket(false);
    setSelectedTicket(newT);
  };

  const handleSendReply = () => {
    if (!replyText.trim() || !selectedTicket) return;
    const updated = {
      ...selectedTicket,
      messages: [
        ...selectedTicket.messages,
        { sender: 'user' as const, text: replyText.trim(), time: 'همین الان' },
      ],
    };
    setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setSelectedTicket(updated);
    setReplyText('');
  };

  return (
    <>
      <AppBar
        title="پشتیبانی و تیکت‌ها"
        sub="پاسخ‌گویی سریع به سؤالات فنی و آموزشی"
        actions={
          !showNewTicket && !selectedTicket ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowNewTicket(true)}
            >
              تیکت جدید
            </Button>
          ) : undefined
        }
      />

      <div className="page">
        {selectedTicket ? (
          <div>
            <div className="row row--between mb-16" style={{ alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => setSelectedTicket(null)}
              >
                <Icon name="i-chevron-r" size={16} />
                بازگشت به فهرست
              </button>
              <Chip
                variant={
                  selectedTicket.status === 'answered'
                    ? 'cyan'
                    : selectedTicket.status === 'closed'
                    ? 'quiet'
                    : 'brand'
                }
              >
                {selectedTicket.status === 'answered'
                  ? 'پاسخ داده شده'
                  : selectedTicket.status === 'closed'
                  ? 'بسته شده'
                  : 'در انتظار پاسخ'}
              </Chip>
            </div>

            <Card className="card--glass mb-16">
              <div className="h3">{selectedTicket.subject}</div>
              <div className="tiny color-muted mt-2">
                دپارتمان: {selectedTicket.department} · شناسه: {selectedTicket.id}
              </div>
            </Card>

            {/* پیام‌های تیکت */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              {selectedTicket.messages.map((m, idx) => {
                const isUser = m.sender === 'user';
                return (
                  <div
                    key={idx}
                    style={{
                      alignSelf: isUser ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                    }}
                  >
                    <div
                      className="card"
                      style={{
                        background: isUser ? 'var(--brand-soft)' : 'var(--paper-2)',
                        border: isUser ? '1px solid rgba(37, 99, 235, 0.3)' : '1px solid var(--line)',
                        borderRadius: isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                        padding: '12px 14px',
                      }}
                    >
                      <div className="tiny color-muted mb-4">
                        {isUser ? 'شما' : 'کارشناس پشتیبانی هامزیار'}
                      </div>
                      <p className="body" style={{ fontSize: 14 }}>{m.text}</p>
                      <div className="tiny color-muted mt-4" style={{ direction: 'ltr', textAlign: 'right' }}>
                        {m.time}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* پاسخ */}
            <Card className="card--glass">
              <div className="row gap-8">
                <input
                  className="input grow"
                  placeholder="پاسخ خود را بنویسید…"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendReply()}
                />
                <Button variant="primary" size="sm" onClick={handleSendReply}>
                  ارسال
                </Button>
              </div>
            </Card>
          </div>
        ) : showNewTicket ? (
          <div>
            <div className="row row--between mb-16" style={{ alignItems: 'center' }}>
              <span className="h3">ارسال درخواست جدید</span>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => setShowNewTicket(false)}
              >
                انصراف
              </button>
            </div>

            <Card className="card--glass">
              <form onSubmit={handleCreateTicket}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Input
                    label="موضوع درخواست"
                    placeholder="مثال: مشکل در باز شدن فایل کتابخوان"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    required
                  />

                  <div>
                    <label className="tiny color-muted" style={{ display: 'block', marginBottom: 6 }}>
                      دپارتمان مربوطه:
                    </label>
                    <select
                      className="input"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      style={{ width: '100%', height: 42 }}
                    >
                      <option value="آموزشی">پشتیبانی آموزشی و سؤالات پزشکی</option>
                      <option value="فنی">پشتیبانی فنی و اپلیکیشن</option>
                      <option value="مالی">امور مالی و تمدید اشتراک</option>
                    </select>
                  </div>

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

                  <div className="mt-8">
                    <Button type="submit" variant="primary" block>
                      ثبت و ارسال تیکت
                    </Button>
                  </div>
                </div>
              </form>
            </Card>
          </div>
        ) : tickets.length === 0 ? (
          <div className="mt-20">
            <EmptyState
              icon="i-message-circle"
              title="تیکتی ثبت نشده است"
              text="در صورت نیاز به راهنمایی یا گزارش مشکل، تیکت جدید ارسال نمایید."
              action={
                <Button variant="primary" size="sm" onClick={() => setShowNewTicket(true)}>
                  ارسال تیکت جدید
                </Button>
              }
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {tickets.map((t) => (
              <Card
                key={t.id}
                onClick={() => setSelectedTicket(t)}
                className="card--glass"
                style={{ cursor: 'pointer', padding: '14px 16px' }}
              >
                <div className="row row--between" style={{ alignItems: 'center' }}>
                  <span className="h3" style={{ fontSize: 14.5 }}>{t.subject}</span>
                  <Chip
                    variant={
                      t.status === 'answered' ? 'cyan' : t.status === 'closed' ? 'quiet' : 'brand'
                    }
                  >
                    {t.status === 'answered'
                      ? 'پاسخ داده شده'
                      : t.status === 'closed'
                      ? 'بسته شده'
                      : 'در انتظار پاسخ'}
                  </Chip>
                </div>
                <div className="row row--between mt-8">
                  <span className="tiny color-muted">{t.department}</span>
                  <span className="tiny color-muted">{t.date}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
