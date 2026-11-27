import { useCallback, useEffect, useState } from 'react';
import './exam.css';
import { AppBar, Toast } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsBadge, DsButton, DsCard, DsChip, DsEmpty, DsSegmented } from '../../design/components';
import { Icon } from '../../icons';
import { errorText } from '../../lib/api';
import {
  OPTION_LETTERS,
  exam,
  questionDesignApi,
  type CatalogLessonItem,
  type MyQuestionDesign,
} from '../../lib/exam';
import { faDate, faNum } from '../../lib/fa';

const DIFF_OPTIONS = ['آسان', 'متوسط', 'سخت'];

const STATUS_BADGE: Record<string, 'success' | 'neutral' | 'warning' | 'danger'> = {
  approved: 'success',
  pending: 'neutral',
  needs_revision: 'warning',
  rejected: 'danger',
  withdrawn: 'neutral',
};

const EMPTY_FORM = {
  id: '',
  lesson: '',
  topic: '',
  question: '',
  options: ['', '', '', ''],
  correct: 0,
  explanation: '',
  difficulty: 'متوسط',
};

export function MyQuestionsScreen() {
  const [tab, setTab] = useState<'create' | 'mine'>('mine');
  const [items, setItems] = useState<MyQuestionDesign[]>([]);
  const [lessons, setLessons] = useState<CatalogLessonItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mineRes, catRes] = await Promise.all([
        questionDesignApi.mine(0, 60),
        exam.catalog().catch(() => null),
      ]);
      setItems(mineRes.questions || []);
      if (catRes?.groups) {
        const flat = catRes.groups.flatMap((g) => g.lessons || []);
        setLessons(flat);
      }
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trimmedOptions = form.options.map((o) => o.trim());
  const valid =
    form.lesson.trim().length > 0 &&
    form.topic.trim().length > 0 &&
    form.question.trim().length >= 10 &&
    trimmedOptions.every((o) => o.length > 0) &&
    new Set(trimmedOptions).size === 4;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const payload = {
        lesson: form.lesson.trim(),
        topic: form.topic.trim(),
        question: form.question.trim(),
        options: trimmedOptions,
        correct: form.correct,
        explanation: form.explanation.trim(),
        difficulty: form.difficulty,
      };
      if (form.id) {
        await questionDesignApi.resubmit(form.id, payload);
        flash('سؤال ویرایش و دوباره برای بررسی ارسال شد.');
      } else {
        const res = await questionDesignApi.create(payload);
        flash(res.message || 'سؤال با موفقیت ثبت شد.');
      }
      setForm(EMPTY_FORM);
      setTab('mine');
      await load();
    } catch (e) {
      flash(errorText(e, 'ذخیرهٔ سؤال انجام نشد.'));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (q: MyQuestionDesign) => {
    setForm({
      id: q.id,
      lesson: q.lesson || '',
      topic: q.topic || '',
      question: q.question || '',
      options: q.options?.length === 4 ? [...q.options] : ['', '', '', ''],
      correct: typeof q.correct === 'number' ? q.correct : 0,
      explanation: q.explanation || '',
      difficulty: q.difficulty?.replace(/[^\w\u0600-\u06FF]/g, '') || 'متوسط',
    });
    setTab('create');
  };

  const withdraw = async (id: string) => {
    try {
      const res = await questionDesignApi.withdraw(id);
      flash(res.message || 'سؤال از صف خارج شد.');
      await load();
    } catch (e) {
      flash(errorText(e));
    }
  };

  return (
    <>
      <AppBar title="طراحی سؤال و مشارکت در بانک" sub="ساخت سؤال استاندارد و پیگیری وضعیت تأیید" back />
      <div className="page page-enter exam-page">
        <DsSegmented
          value={tab}
          onChange={(v) => {
            if (v === 'mine') setForm(EMPTY_FORM);
            setTab(v);
          }}
          label="طراحی سؤال"
          block
          options={[
            { value: 'mine', label: `سؤال‌های من (${faNum(items.length)})` },
            { value: 'create', label: form.id ? 'ویرایش سؤال' : 'طراحی سؤال جدید' },
          ]}
        />

        {tab === 'mine' && (
          <div className="exam-stack" style={{ marginTop: 14 }}>
            {loading && <LoadingBlock rows={3} />}
            {!loading && error != null && <ErrorBlock error={error} onRetry={load} />}
            {!loading && error == null && items.length === 0 && (
              <DsCard>
                <DsEmpty
                  icon={<Icon name="i-pen" size={28} />}
                  title="هنوز سؤالی طراحی نکرده‌اید"
                  body="با طراحی سؤال استاندارد از مباحث درسی، هم به هم‌کلاسی‌ها کمک کنید و هم امتیاز تجربه بگیرید."
                  action={
                    <DsButton variant="primary" onClick={() => setTab('create')}>
                      <Icon name="i-plus" size={16} />
                      طراحی اولین سؤال
                    </DsButton>
                  }
                />
              </DsCard>
            )}
            {!loading && error == null && items.length > 0 && (
              <div className="exam-stack">
                {items.map((item) => (
                  <DsCard key={item.id} className="exam-stack">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="small muted">
                        {[item.lesson, item.topic].filter(Boolean).join(' · ')}
                      </span>
                      <DsBadge tone={STATUS_BADGE[item.status] || 'neutral'}>
                        {item.status_label || item.status}
                      </DsBadge>
                    </div>
                    <p style={{ margin: 0, fontWeight: 600, lineHeight: 1.7 }}>{item.question}</p>
                    <div className="exam-stack" style={{ gap: 6 }}>
                      {(item.options || []).map((opt, idx) => (
                        <div
                          key={idx}
                          className="small"
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            background: idx === item.correct ? 'color-mix(in srgb, var(--hym-role-grades-text) 12%, transparent)' : 'var(--paper-2)',
                          }}
                        >
                          <strong>{OPTION_LETTERS[idx] || faNum(idx + 1)})</strong> {opt}
                        </div>
                      ))}
                    </div>
                    {item.review_note && (
                      <p className="small muted" style={{ margin: 0 }}>
                        یادداشت داور: {item.review_note}
                      </p>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="tiny muted">{item.created_at ? faDate(item.created_at) : ''}</span>
                      {!item.approved && (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <DsButton size="sm" variant="secondary" onClick={() => startEdit(item)}>
                            ویرایش
                          </DsButton>
                          <DsButton size="sm" variant="ghost" onClick={() => void withdraw(item.id)}>
                            انصراف از صف
                          </DsButton>
                        </div>
                      )}
                    </div>
                  </DsCard>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'create' && (
          <DsCard className="exam-stack" style={{ marginTop: 14 }}>
            <div className="exam-stack">
              <label className="small muted">درس (انتخاب یا تایپ نام درس)</label>
              <input
                list="design-lessons-list"
                className="ds-input"
                value={form.lesson}
                onChange={(e) => setForm({ ...form, lesson: e.target.value })}
                placeholder="مثلاً فیزیولوژی قلب یا آناتومی سر و گردن"
              />
              <datalist id="design-lessons-list">
                {lessons.map((l) => (
                  <option key={l.id} value={l.name} />
                ))}
              </datalist>
            </div>

            <div className="exam-stack">
              <label className="small muted">مبحث</label>
              <input
                type="text"
                className="ds-input"
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
                placeholder="نام مبحث یا فصل"
              />
            </div>

            <div className="exam-stack">
              <label className="small muted">صورت سؤال (حداقل ۱۰ کاراکتر)</label>
              <textarea
                rows={3}
                className="ds-input"
                value={form.question}
                onChange={(e) => setForm({ ...form, question: e.target.value })}
                placeholder="متن کامل سؤال را بنویسید…"
                style={{ resize: 'vertical' }}
              />
            </div>

            <div className="exam-stack">
              <label className="small muted">چهار گزینه و انتخاب گزینهٔ صحیح</label>
              {form.options.map((opt, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="radio"
                    name="correct-opt"
                    checked={form.correct === idx}
                    onChange={() => setForm({ ...form, correct: idx })}
                    aria-label={`گزینه ${OPTION_LETTERS[idx]} درست است`}
                  />
                  <span style={{ minWidth: 24, fontWeight: 700 }}>{OPTION_LETTERS[idx]}</span>
                  <input
                    type="text"
                    className="ds-input"
                    style={{ flex: 1 }}
                    value={opt}
                    onChange={(e) => {
                      const next = [...form.options];
                      next[idx] = e.target.value;
                      setForm({ ...form, options: next });
                    }}
                    placeholder={`متن گزینهٔ ${OPTION_LETTERS[idx]}`}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="small muted">سطح سختی:</span>
              {DIFF_OPTIONS.map((d) => (
                <DsChip
                  key={d}
                  selected={form.difficulty === d}
                  onClick={() => setForm({ ...form, difficulty: d })}
                >
                  {d}
                </DsChip>
              ))}
            </div>

            <div className="exam-stack">
              <label className="small muted">توضیح تشریحی و پاسخنامه (اختیاری)</label>
              <textarea
                rows={3}
                className="ds-input"
                value={form.explanation}
                onChange={(e) => setForm({ ...form, explanation: e.target.value })}
                placeholder="دلیل علمی درست بودن گزینهٔ انتخابی…"
                style={{ resize: 'vertical' }}
              />
            </div>

            <DsButton variant="primary" block loading={saving} disabled={!valid} onClick={() => void submit()}>
              <Icon name="i-check" size={16} />
              {form.id ? 'ثبت ویرایش و ارسال مجدد' : 'ارسال سؤال برای بررسی'}
            </DsButton>
          </DsCard>
        )}
      </div>
      <Toast message={toast} />
    </>
  );
}
