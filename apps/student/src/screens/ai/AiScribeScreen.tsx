import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppBar, Toast } from '../../components';
import { DsBadge, DsButton, DsCard, DsEmpty, DsSkeleton } from '../../design/components';
import { Icon } from '../../icons/Icon';
import { lectureApi, type LectureJob } from '../../lib/ai';
import { faNum } from '../../lib/fa';
import './ai-studio.css';

interface LectureCfg {
  enabled: boolean;
  daily_limit: number;
  used_today: number;
  remaining_today: number;
  unlimited: boolean;
  max_upload_mb: number;
}

function formatSizeMb(bytes: number): string {
  if (!bytes || bytes <= 0) return '۰';
  return faNum(Math.max(0.1, Number((bytes / (1024 * 1024)).toFixed(1))));
}

function getErrDetail(err: unknown): { message: string; locked: boolean } {
  const e = err as { status?: number; message?: string; data?: { code?: string; detail?: string } };
  const locked = e?.status === 402 || e?.data?.code === 'FEATURE_LOCKED';
  const detail = e?.data?.detail;
  return {
    message: (typeof detail === 'string' && detail.trim()) || e?.message || 'عملیات ناموفق بود.',
    locked,
  };
}

export function AiScribeScreen() {
  const nav = useNavigate();
  const audioInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);

  const [cfg, setCfg] = useState<LectureCfg | null>(null);
  const [jobs, setJobs] = useState<LectureJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [slidesFile, setSlidesFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);

  const loadAll = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [c, j] = await Promise.all([lectureApi.config(), lectureApi.jobs()]);
      setCfg(c);
      setJobs(j.jobs || []);
      setLocked(false);
    } catch (err) {
      const info = getErrDetail(err);
      setError(info.message);
      setLocked(info.locked);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll(false);
  }, [loadAll]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const hasProcessing = jobs.some((j) => j.status === 'processing');
  useEffect(() => {
    if (!hasProcessing) return undefined;
    const t = window.setInterval(() => {
      void loadAll(true);
    }, 4000);
    return () => window.clearInterval(t);
  }, [hasProcessing, loadAll]);

  useEffect(() => {
    if (!recording) return undefined;
    const t = window.setInterval(() => setRecordSec((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [recording]);

  async function toggleMicRecord() {
    if (recording && recorderRef.current) {
      recorderRef.current.stop();
      setRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setToast('مرورگر شما ضبط صوت مستقیم را پشتیبانی نمی‌کند؛ فایل صوتی انتخاب کنید.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recordChunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(recordChunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size > 0) {
          const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
          const file = new File([blob], `lecture-${Date.now()}.${ext}`, { type: blob.type || 'audio/webm' });
          setAudioFile(file);
          setToast('صدای ضبط‌شده به فرم جزوه‌نویس پیوست شد.');
        }
      };
      recorderRef.current = rec;
      setRecordSec(0);
      setRecording(true);
      rec.start(500);
    } catch {
      setToast('دسترسی به میکروفون داده نشد.');
    }
  }

  async function submitJob() {
    if (submitting || (!audioFile && !slidesFile)) return;
    const maxBytes = (cfg?.max_upload_mb || 80) * 1024 * 1024;
    if (audioFile && audioFile.size > maxBytes) {
      setError(`حجم فایل صوتی/ویدیویی بیش از حد مجاز (${faNum(cfg?.max_upload_mb || 80)} مگابایت) است.`);
      return;
    }
    if (slidesFile && slidesFile.size > maxBytes) {
      setError(`حجم اسلاید PDF بیش از حد مجاز (${faNum(cfg?.max_upload_mb || 80)} مگابایت) است.`);
      return;
    }
    setSubmitting(true);
    setError('');
    setLocked(false);
    try {
      await lectureApi.create({ audio: audioFile, slides: slidesFile, notes });
      setAudioFile(null);
      setSlidesFile(null);
      setNotes('');
      setToast('سفارش تولید جزوه ثبت شد و هوشیار در حال پردازش است.');
      await loadAll(true);
    } catch (err) {
      const info = getErrDetail(err);
      setError(info.message);
      setLocked(info.locked);
    } finally {
      setSubmitting(false);
    }
  }

  async function removeJob(jobId: string) {
    try {
      await lectureApi.deleteJob(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      setToast('جزوه حذف شد.');
    } catch (err) {
      setToast(getErrDetail(err).message);
    }
  }

  return (
    <div className="screen ais-page">
      <AppBar
        title="جزوه‌نویس هوشمند کلاسی"
        sub="تبدیل صوت یا ویدیوی تدریس + اسلاید PDF به جزوه ساختارمند آکادمیک"
        back
        onBack={() => nav('/ai')}
      />

      {loading ? (
        <DsCard className="ais-section">
          <DsSkeleton shape="title" />
          <DsSkeleton shape="card" />
        </DsCard>
      ) : (
        <DsCard className="ais-section">
          <div className="ais-head-row">
            <h2 className="ais-title">ثبت جلسه جدید</h2>
            {cfg && (
              <DsBadge tone={cfg.unlimited ? 'success' : cfg.remaining_today > 0 ? 'accent' : 'warning'}>
                {cfg.unlimited
                  ? 'سهمیه روزانه: نامحدود'
                  : `باقی‌مانده امروز: ${faNum(cfg.remaining_today)} از ${faNum(cfg.daily_limit)}`}
              </DsBadge>
            )}
          </div>

          <p className="ais-sub">
            می‌توانید صوت/ویدیوی کلاس، اسلاید PDF یا هر دو را هم‌زمان بارگذاری کنید (حداکثر{' '}
            {faNum(cfg?.max_upload_mb || 80)} مگابایت).
          </p>

          <div className="ais-dropgrid">
            <div className={`ais-file-box${audioFile ? ' ais-file-box--filled' : ''}`}>
              <input
                ref={audioInputRef}
                className="ais-file-input"
                type="file"
                accept="audio/*,video/*,.mp3,.m4a,.wav,.ogg,.webm,.mp4,.mkv"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  if (f) setAudioFile(f);
                  e.target.value = '';
                }}
              />
              <div className="ais-head-row">
                <strong>صوت یا ویدیوی تدریس</strong>
                {audioFile && <DsBadge tone="accent">{formatSizeMb(audioFile.size)} MB</DsBadge>}
              </div>
              <span className="ais-sub">
                {audioFile ? audioFile.name : 'انتخاب فایل یا ضبط زنده از میکروفون'}
              </span>
              <div className="ais-actions">
                <DsButton variant="secondary" size="sm" onClick={() => audioInputRef.current?.click()}>
                  <Icon name="i-upload" />
                  انتخاب فایل
                </DsButton>
                <DsButton
                  variant={recording ? 'danger' : 'ghost'}
                  size="sm"
                  onClick={toggleMicRecord}
                >
                  <Icon name="i-headphones" />
                  {recording ? `توقف ضبط (${faNum(recordSec)} ثانیه)` : 'ضبط از میکروفون'}
                </DsButton>
                {audioFile && (
                  <DsButton variant="ghost" size="sm" onClick={() => setAudioFile(null)}>
                    حذف
                  </DsButton>
                )}
              </div>
            </div>

            <div className={`ais-file-box${slidesFile ? ' ais-file-box--filled' : ''}`}>
              <input
                ref={pdfInputRef}
                className="ais-file-input"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  if (f) setSlidesFile(f);
                  e.target.value = '';
                }}
              />
              <div className="ais-head-row">
                <strong>اسلاید یا جزوه پایه (PDF)</strong>
                {slidesFile && <DsBadge tone="accent">{formatSizeMb(slidesFile.size)} MB</DsBadge>}
              </div>
              <span className="ais-sub">
                {slidesFile ? slidesFile.name : 'اختیاری — برای تطبیق دقیق‌تر سرفصل‌ها'}
              </span>
              <div className="ais-actions">
                <DsButton variant="secondary" size="sm" onClick={() => pdfInputRef.current?.click()}>
                  <Icon name="i-file-text" />
                  انتخاب PDF
                </DsButton>
                {slidesFile && (
                  <DsButton variant="ghost" size="sm" onClick={() => setSlidesFile(null)}>
                    حذف
                  </DsButton>
                )}
              </div>
            </div>
          </div>

          <textarea
            className="ais-textarea"
            style={{ minHeight: 72 }}
            placeholder="یادداشت اختیاری (نام درس، نام استاد، شماره جلسه یا بخش‌های مهم برای تأکید بیشتر)…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
          />

          <div className="ais-actions">
            <DsButton
              variant="primary"
              disabled={submitting || recording || (!audioFile && !slidesFile)}
              onClick={submitJob}
            >
              <Icon name="i-zap" />
              {submitting ? 'در حال ارسال و صف‌بندی…' : 'شروع تدوین جزوه PDF'}
            </DsButton>
            <DsButton variant="ghost" onClick={() => loadAll(false)}>
              بروزرسانی فهرست
            </DsButton>
          </div>
        </DsCard>
      )}

      {error && (
        <DsCard level="raised" className="ais-section">
          <p className="ais-title" style={{ color: 'var(--danger)' }}>
            {locked ? 'این قابلیت ویژه اشتراک کامل است' : 'خطا در جزوه‌نویس'}
          </p>
          <p className="ais-sub">{error}</p>
          {locked && (
            <div>
              <Link className="btn btn--primary btn--sm" to="/subscription">
                ارتقا به اشتراک کامل
              </Link>
            </div>
          )}
        </DsCard>
      )}

      <div className="ais-section">
        <h2 className="ais-title">جزوه‌های تولیدشده شما ({faNum(jobs.length)})</h2>

        {!loading && jobs.length === 0 ? (
          <DsCard level="sunken">
            <DsEmpty
              icon={<Icon name="i-file-text" />}
              title="هنوز جزوه‌ای نساخته‌اید"
              body="فایل صوتی کلاس یا PDF اسلایدها را از فرم بالا ارسال کنید تا هوشیار جزوه کامل PDF بسازد."
            />
          </DsCard>
        ) : (
          jobs.map((job) => {
            const tone = job.status === 'ready' ? 'success' : job.status === 'failed' ? 'danger' : 'warning';
            const badgeText =
              job.status === 'ready' ? 'آماده مطالعه' : job.status === 'failed' ? 'ناموفق' : 'در حال پردازش';
            return (
              <DsCard key={job.id} level="raised" className="ais-section">
                <div className="ais-head-row">
                  <div>
                    <h3 className="ais-title">{job.title || 'جزوه درسی'}</h3>
                    {(job.subject || job.professor) && (
                      <p className="ais-sub">
                        {[job.subject, job.professor].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <DsBadge tone={tone}>{badgeText}</DsBadge>
                </div>

                {job.status_text && <p className="ais-sub">{job.status_text}</p>}
                {job.error && (
                  <p className="ais-sub" style={{ color: 'var(--danger)' }}>
                    {job.error}
                  </p>
                )}

                {job.summary?.executive_summary && (
                  <p className="ais-sub">{job.summary.executive_summary}</p>
                )}

                {job.status === 'ready' && job.summary && (
                  <div className="ais-chips">
                    {typeof job.summary.topics_count === 'number' && (
                      <DsBadge>{faNum(job.summary.topics_count)} سرفصل</DsBadge>
                    )}
                    {typeof job.summary.pearls_count === 'number' && (
                      <DsBadge tone="accent">{faNum(job.summary.pearls_count)} نکته بالینی</DsBadge>
                    )}
                    {typeof job.summary.traps_count === 'number' && (
                      <DsBadge tone="warning">{faNum(job.summary.traps_count)} دام تستی</DsBadge>
                    )}
                    {typeof job.summary.qna_count === 'number' && (
                      <DsBadge>{faNum(job.summary.qna_count)} پرسش و پاسخ</DsBadge>
                    )}
                  </div>
                )}

                <div className="ais-actions">
                  {job.pdf_ready && (
                    <>
                      <a
                        className="btn btn--primary btn--sm"
                        href={lectureApi.pdfUrl(job.id, true)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Icon name="i-file-text" />
                        مشاهده آنلاین PDF
                      </a>
                      <a
                        className="btn btn--secondary btn--sm"
                        href={lectureApi.pdfUrl(job.id, false)}
                        download={`${job.title || 'lecture'}.pdf`}
                      >
                        <Icon name="i-download" />
                        دانلود ({formatSizeMb(job.pdf_size)} MB)
                      </a>
                    </>
                  )}
                  <DsButton variant="ghost" size="sm" onClick={() => removeJob(job.id)}>
                    <Icon name="i-trash" />
                    حذف
                  </DsButton>
                </div>
              </DsCard>
            );
          })
        )}
      </div>

      <Toast message={toast} />
    </div>
  );
}
