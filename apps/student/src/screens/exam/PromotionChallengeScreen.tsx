import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './exam.css';
import { AppBar, Toast } from '../../components';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsBadge, DsButton, DsCard, DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import { apiCall, errorText } from '../../lib/api';
import { OPTION_LETTERS, promotionApi, type MockNext } from '../../lib/exam';
import { faNum, faPercent } from '../../lib/fa';

interface ChallengeView {
  eligible?: boolean;
  can_start?: boolean;
  reason?: string;
  cooldown_hours?: number;
  target_rank?: string;
  title?: string;
  icon?: string;
  count?: number;
  pass_pct?: number;
  apex?: boolean;
  active_session_id?: string;
}

export function PromotionChallengeScreen() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [prestige, setPrestige] = useState<Record<string, any> | null>(null);
  const [sid, setSid] = useState<string>('');
  const [current, setCurrent] = useState<MockNext | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    win: boolean;
    pct: number;
    pass_pct: number;
    need: number;
    reward: number;
    target_rank?: string;
    cooldown_h?: number;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  const loadPrestige = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiCall<{ prestige: Record<string, any> }>('/api/profile/prestige');
      setPrestige(res.prestige || {});
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPrestige();
  }, [loadPrestige]);

  const startOrResume = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const started = await promotionApi.start();
      setSid(started.session_id);
      const qRes = await promotionApi.next(started.session_id);
      setCurrent(qRes);
      setSelected(null);
    } catch (e) {
      flash(errorText(e, 'شروع چالش ارتقا ممکن نشد.'));
    } finally {
      setBusy(false);
    }
  };

  const submitAnswer = async () => {
    if (!sid || selected === null || busy) return;
    setBusy(true);
    try {
      const ans = await promotionApi.answer(sid, selected);
      setSelected(null);
      if (ans.promotion_result) {
        setResult(ans.promotion_result);
        setCurrent(null);
        await loadPrestige();
        return;
      }
      const nextQ = await promotionApi.next(sid);
      if (nextQ.finished) {
        setCurrent(null);
        await loadPrestige();
      } else {
        setCurrent(nextQ);
      }
    } catch (e) {
      flash(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const ch: ChallengeView = prestige?.challenge || {};

  return (
    <>
      <AppBar title="چالش ارتقای رتبه" sub="آزمون علمی برای فتح رتبهٔ بالاتر" back />
      <div className="page page-enter exam-page">
        {loading && <LoadingBlock rows={2} />}
        {!loading && error != null && <ErrorBlock error={error} onRetry={loadPrestige} />}

        {!loading && error == null && result && (
          <DsCard level="accent" className="exam-stack">
            <DsBadge tone={result.win ? 'success' : 'danger'}>
              {result.win ? 'رتبه ارتقا یافت!' : 'چالش این نوبت تکمیل نشد'}
            </DsBadge>
            <h2 className="h2" style={{ margin: 0 }}>
              نمرهٔ شما: {faPercent(Math.round(result.pct))} (حدنصاب: {faPercent(result.pass_pct)})
            </h2>
            <p className="small muted" style={{ margin: 0 }}>
              {result.win
                ? `تبریک! ${result.reward ? `${faNum(result.reward)} XP پاداش دریافت کردید و ` : ''}رتبهٔ جدید فعال شد.`
                : `پس از سپری‌شدن زمان استراحت (${faNum(result.cooldown_h || 24)} ساعت) دوباره می‌توانید شرکت کنید.`}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <DsButton variant="primary" onClick={() => navigate('/leaderboard')}>
                مشاهدهٔ رتبه و نشان‌ها
              </DsButton>
              <DsButton variant="ghost" onClick={() => navigate('/exam')}>
                بازگشت به بانک سؤال
              </DsButton>
            </div>
          </DsCard>
        )}

        {!loading && error == null && !result && current?.question && (
          <DsCard className="exam-stack">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="small muted">{current.question.lesson}</span>
              <DsBadge tone="accent">
                سؤال {faNum(current.progress || 1)} از {faNum(current.total || 10)}
              </DsBadge>
            </div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, lineHeight: 1.8 }}>
              {current.question.question}
            </p>
            <ul className="exam-options">
              {current.question.options.map((opt, idx) => (
                <li key={idx}>
                  <button
                    type="button"
                    className={`exam-opt${selected === idx ? ' is-picked' : ''}`}
                    onClick={() => setSelected(idx)}
                  >
                    <span className="exam-opt__letter">{OPTION_LETTERS[idx] || faNum(idx + 1)}</span>
                    <span className="exam-opt__text">{opt}</span>
                  </button>
                </li>
              ))}
            </ul>
            <DsButton
              variant="primary"
              block
              disabled={selected === null}
              loading={busy}
              onClick={() => void submitAnswer()}
            >
              ثبت پاسخ و ادامه
            </DsButton>
          </DsCard>
        )}

        {!loading && error == null && !result && !current && (
          <DsCard className="exam-stack">
            <DsEmpty
              icon={<Icon name="i-award" size={30} />}
              title={ch.title ? `چالش صعود به: ${ch.title}` : 'وضعیت چالش ارتقا'}
              body={
                ch.eligible || ch.can_start || ch.active_session_id
                  ? `با پاسخ درست به حداقل ${faPercent(ch.pass_pct || 75)} از سؤالات منتخب بانک، بدون انتظار XP به رتبهٔ بالاتر ارتقا می‌یابید.`
                  : ch.reason || 'در حال حاضر این چالش برای شما قفل است یا امتیاز کافی برای سطح بعدی هنوز جمع نشده است.'
              }
              action={
                (ch.eligible || ch.can_start || ch.active_session_id) ? (
                  <DsButton variant="primary" loading={busy} onClick={() => void startOrResume()}>
                    <Icon name="i-zap" size={16} />
                    {ch.active_session_id ? 'ادامهٔ چالش ناتمام' : 'شروع چالش ارتقا'}
                  </DsButton>
                ) : (
                  <DsButton variant="secondary" onClick={() => navigate('/exam')}>
                    بازگشت به بانک سؤال
                  </DsButton>
                )
              }
            />
          </DsCard>
        )}
      </div>
      <Toast message={toast} />
    </>
  );
}
