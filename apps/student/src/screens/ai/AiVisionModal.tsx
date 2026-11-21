import { useState, useRef, type ChangeEvent, type DragEvent } from 'react';
import { Sheet } from '../../components/Sheet';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Icon } from '../../icons';
import { diagnoseClinicalImage, type VisionDiagnosisResult } from '../../lib/ai';

export interface AiVisionModalProps {
  open: boolean;
  onClose: () => void;
  onApplyToChat?: (result: VisionDiagnosisResult, imageUrl: string, prompt: string) => void;
}

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export function AiVisionModal({ open, onClose, onApplyToChat }: AiVisionModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('لطفاً این تصویر پزشکی را تحلیل و نکات آموزشی آن را توضیح دهید.');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VisionDiagnosisResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setSelectedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    setLoading(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFile = (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('فقط فایل‌های تصویری (JPEG, PNG, WebP) مجاز هستند.');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setError('حجم فایل تصویر نباید بیشتر از ۱۰ مگابایت باشد.');
      return;
    }
    setSelectedFile(file);
    const objUrl = URL.createObjectURL(file);
    setPreviewUrl(objUrl);
    setResult(null);
  };

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const onDragLeave = () => {
    setDragActive(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedFile || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await diagnoseClinicalImage(selectedFile, prompt);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تحلیل تصویر بالینی');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (result && previewUrl) {
      onApplyToChat?.(result, previewUrl, prompt);
      onClose();
    }
  };

  return (
    <Sheet open={open} onClose={handleClose} title="تحلیل بالینی تصویر پزشکی">
      <div style={{ padding: '12px 16px 28px', maxHeight: '80vh', overflowY: 'auto' }}>
        <p className="small color-muted mb-16">
          تصاویر رادیولوژی، پاتولوژی، نوار قلب (ECG) یا دیاگرام‌های آناتومیک را بارگذاری کن تا هوش‌یار آن‌ها را تحلیل آموزشی کند.
        </p>

        {error && (
          <div className="notice notice--warn mb-16" role="alert" style={{ color: 'var(--danger)' }}>
            <Icon name="i-alert-circle" size={16} />
            <span className="small">{error}</span>
          </div>
        )}

        {/* جعبه انتخاب / کشیدن فایل */}
        {!previewUrl ? (
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragActive ? 'var(--hym-neon-cyan)' : 'var(--line-2)'}`,
              borderRadius: 'var(--r-lg)',
              padding: '36px 20px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragActive ? 'var(--cyan-soft)' : 'var(--paper-2)',
              transition: 'all var(--t-fast) ease',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={onFileInputChange}
            />
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: 'var(--brand-soft)',
                color: 'var(--brand)',
                display: 'grid',
                placeItems: 'center',
                margin: '0 auto 12px',
              }}
            >
              <Icon name="i-upload" size={26} />
            </div>
            <div className="h3" style={{ fontSize: 15 }}>انتخاب یا رها کردن تصویر بالینی</div>
            <p className="tiny color-muted mt-4">حداکثر ۱۰ مگابایت (JPG, PNG, WebP)</p>
          </div>
        ) : (
          <div className="mb-16">
            <div
              className="card card--glass"
              style={{
                position: 'relative',
                padding: '12px',
                textAlign: 'center',
                overflow: 'hidden',
              }}
            >
              <img
                src={previewUrl}
                alt="پیش‌نمایش بالینی"
                style={{
                  maxHeight: 240,
                  maxWidth: '100%',
                  borderRadius: 'var(--r-md)',
                  objectFit: 'contain',
                  margin: '0 auto',
                  display: 'block',
                }}
              />
              <div className="row gap-8 mt-12" style={{ justifyContent: 'center' }}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedFile(null);
                    setPreviewUrl(null);
                    setResult(null);
                  }}
                  disabled={loading}
                >
                  تعویض تصویر
                </Button>
              </div>
            </div>

            {/* دستورالعمل تکمیلی */}
            <div className="mt-16">
              <label className="tiny color-muted" style={{ display: 'block', marginBottom: 6 }}>
                دستورالعمل یا سؤال مد نظر برای این تصویر:
              </label>
              <textarea
                className="input"
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={loading}
                style={{ width: '100%', resize: 'vertical', fontSize: 13 }}
              />
            </div>

            {/* دکمه ارسال تحلیل */}
            {!result && (
              <div className="mt-16">
                <Button
                  variant="primary"
                  block
                  loading={loading}
                  onClick={() => void handleAnalyze()}
                >
                  {loading ? 'در حال تحلیل بالینی…' : 'شروع تحلیل تصویر'}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* نتیجه تحلیل هوشمند */}
        {result && (
          <div className="card card--glass mt-16" style={{ borderInlineStart: '3px solid var(--hym-neon-cyan)' }}>
            <div className="row gap-8 mb-8" style={{ alignItems: 'center' }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'var(--cyan-soft)',
                  color: 'var(--cyan)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Icon name="i-flask" size={18} />
              </div>
              <span className="h3">تحلیل ساختارمند بالینی</span>
              <span className="grow" />
              <Chip variant="cyan">آموزش پزشکی</Chip>
            </div>

            <div
              className="body mt-12"
              style={{
                fontSize: 14,
                lineHeight: 1.8,
                whiteSpace: 'pre-wrap',
                color: 'var(--ink)',
              }}
            >
              {result.analysis}
            </div>

            {result.detected_structures && result.detected_structures.length > 0 && (
              <div className="mt-16 pt-12" style={{ borderTop: '1px solid var(--line)' }}>
                <span className="tiny color-muted">یافته‌ها و ساختارهای شناسایی‌شده:</span>
                <div className="row gap-6 mt-6" style={{ flexWrap: 'wrap' }}>
                  {result.detected_structures.map((s, idx) => (
                    <Chip key={idx} variant="quiet">{s}</Chip>
                  ))}
                </div>
              </div>
            )}

            <div className="row row--between mt-16 pt-12" style={{ borderTop: '1px solid var(--line)', alignItems: 'center' }}>
              <span className="tiny color-muted">
                توکن مصرفی: {result.tokens_used} · صرفاً کاربرد مرجع آموزشی
              </span>
              {onApplyToChat && (
                <Button variant="primary" size="sm" onClick={handleApply}>
                  انتقال به گفت‌وگو
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
