import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppBar, Toast } from '../../components';
import { DsBadge, DsButton, DsCard, DsChip } from '../../design/components';
import { Icon } from '../../icons/Icon';
import { ai } from '../../lib/ai';
import { faNum } from '../../lib/fa';
import './ai-studio.css';

const RATIOS = [
  { id: '1:1', label: '۱:۱ مربع' },
  { id: '4:3', label: '۴:۳ اسلاید' },
  { id: '3:4', label: '۳:۴ پرتره' },
  { id: '16:9', label: '۱۶:۹ عریض' },
  { id: '9:16', label: '۹:۱۶ استوری' },
  { id: '3:2', label: '۳:۲' },
  { id: '2:3', label: '۲:۳' },
  { id: '21:9', label: '۲۱:۹' },
  { id: '5:4', label: '۵:۴' },
  { id: '4:5', label: '۴:۵' },
] as const;

const PROMPT_SAMPLES = [
  'شماتیک تمیز نفرون کلیه با برچسب‌گذاری واضح بخش‌های قشری و مرکزی به سبک اطلس پزشکی',
  'ساختار سیناپس عصبی و انتقال‌دهنده‌های عصبی به صورت تصویر آموزشی با رنگ‌بندی شفاف',
  'نمودار شماتیک گردش خون کوچک و بزرگ قلب انسان با فلش‌های جهت جریان خون',
];

const MIN_LEN = 3;
const MAX_LEN = 1000;

interface ImageUsage {
  used_today: number;
  daily_limit: number;
  remaining: number | null;
  unlimited: boolean;
}

function getErrInfo(err: unknown): { message: string; locked: boolean } {
  const e = err as { status?: number; message?: string; data?: { code?: string; detail?: string } };
  const locked = e?.status === 402 || e?.data?.code === 'FEATURE_LOCKED';
  const detail = e?.data?.detail;
  const msg = (typeof detail === 'string' && detail.trim()) || e?.message || 'ساخت تصویر انجام نشد.';
  return { message: msg, locked };
}

export function AiImageScreen() {
  const nav = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('1:1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [result, setResult] = useState<{ image: string; mime: string; model?: string } | null>(null);
  const [usage, setUsage] = useState<ImageUsage | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const trimmed = prompt.trim();
  const valid = trimmed.length >= MIN_LEN && trimmed.length <= MAX_LEN;

  const imageSrc = useMemo(() => {
    if (!result?.image) return '';
    return `data:${result.mime || 'image/png'};base64,${result.image}`;
  }, [result]);

  async function generate() {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    setLocked(false);
    try {
      const res = await ai.generateImage(trimmed, ratio);
      setResult({ image: res.image, mime: res.mime, model: res.model });
      if (res.usage) {
        setUsage(res.usage);
      }
    } catch (err) {
      const info = getErrInfo(err);
      setError(info.message);
      setLocked(info.locked);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen ais-page">
      <AppBar
        title="تصویرساز پزشکی هوشیار"
        sub="تولید شماتیک، دیاگرام و تصویر آموزشی با هوش مصنوعی"
        back
        onBack={() => nav('/ai')}
      />

      <DsCard className="ais-section">
        <div className="ais-head-row">
          <h2 className="ais-title">توصیف تصویر موردنظر</h2>
          {usage && (
            <DsBadge tone={usage.unlimited ? 'success' : 'accent'}>
              {usage.unlimited
                ? 'سهمیه تصویرساز: نامحدود'
                : `مصرف امروز: ${faNum(usage.used_today)} از ${faNum(usage.daily_limit)}`}
            </DsBadge>
          )}
        </div>

        <textarea
          className="ais-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={MAX_LEN}
          placeholder="مثلاً: یک دیاگرام تمیز و آموزشی از لایه‌های پوست انسان به سبک اطلس پزشکی مدرن…"
        />

        <div className="ais-head-row">
          <span className="ais-sub">{faNum(trimmed.length)} / {faNum(MAX_LEN)} نویسه</span>
          {prompt && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPrompt('')}>
              پاک کردن متن
            </button>
          )}
        </div>

        <div className="ais-section" style={{ gap: 8 }}>
          <span className="ais-sub">نمونه پرامپت‌های پزشکی:</span>
          <div className="ais-chips">
            {PROMPT_SAMPLES.map((sample) => (
              <DsChip key={sample} onClick={() => setPrompt(sample)}>
                {sample.slice(0, 38)}…
              </DsChip>
            ))}
          </div>
        </div>

        <div className="ais-section" style={{ gap: 8 }}>
          <span className="ais-sub">نسبت ابعاد تصویر:</span>
          <div className="ais-chips">
            {RATIOS.map((r) => (
              <DsChip key={r.id} selected={ratio === r.id} onClick={() => setRatio(r.id)}>
                {r.label}
              </DsChip>
            ))}
          </div>
        </div>

        <div className="ais-actions">
          <DsButton variant="primary" disabled={!valid || busy} onClick={generate}>
            <Icon name="i-palette" />
            {busy ? 'در حال ساخت تصویر…' : 'ساخت تصویر'}
          </DsButton>
          <DsButton variant="ghost" onClick={() => nav('/ai')}>
            بازگشت به گفت‌وگو
          </DsButton>
        </div>
      </DsCard>

      {error && (
        <DsCard level="raised" className="ais-section">
          <p className="ais-title" style={{ color: 'var(--danger)' }}>
            {locked ? 'این قابلیت نیازمند اشتراک ویژه است' : 'خطا در تولید تصویر'}
          </p>
          <p className="ais-sub">{error}</p>
          {locked && (
            <div>
              <Link className="btn btn--primary btn--sm" to="/subscription">
                مشاهده و فعال‌سازی اشتراک
              </Link>
            </div>
          )}
        </DsCard>
      )}

      {busy && !result && (
        <DsCard level="sunken" className="ais-section" style={{ textAlign: 'center' }}>
          <p className="ais-title">هوشیار در حال طراحی تصویر شماست…</p>
          <p className="ais-sub">ممکن است تا حدود یک دقیقه زمان ببرد؛ لطفاً این صفحه را نبندید.</p>
        </DsCard>
      )}

      {imageSrc && (
        <DsCard level="raised" className="ais-section">
          <div className="ais-head-row">
            <h3 className="ais-title">تصویر آماده شد</h3>
            {result?.model && <DsBadge tone="neutral">{result.model}</DsBadge>}
          </div>

          <div className="ais-img-wrap">
            <img src={imageSrc} alt={trimmed || 'تصویر ساخته‌شده هوشیار'} />
          </div>

          <div className="ais-actions">
            <a
              className="btn btn--primary"
              href={imageSrc}
              download={`hoshyar-${Date.now()}.png`}
              onClick={() => setToast('دانلود تصویر آغاز شد.')}
            >
              <Icon name="i-download" />
              دانلود تصویر
            </a>
            <DsButton variant="secondary" disabled={busy || !valid} onClick={generate}>
              ساخت دوباره
            </DsButton>
          </div>
        </DsCard>
      )}

      <Toast message={toast} />
    </div>
  );
}
