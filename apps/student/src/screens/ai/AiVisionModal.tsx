import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Sheet } from '../../components/Sheet';
import { Chip } from '../../components/Chip';
import { DsButton } from '../../design/components';
import { Icon } from '../../icons';
import { diagnoseClinicalImage, type VisionDiagnosisResult } from '../../lib/ai';

export interface AiVisionModalProps {
  open: boolean;
  onClose: () => void;
  onApplyToChat?: (result: VisionDiagnosisResult, imageUrl: string, prompt: string) => void;
}

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_PROMPT = 'لطفاً این تصویر پزشکی را تحلیل و نکات آموزشی آن را توضیح دهید.';

export function AiVisionModal({ open, onClose, onApplyToChat }: AiVisionModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VisionDiagnosisResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const handedOffUrlRef = useRef<string | null>(null);

  previewUrlRef.current = previewUrl;

  const revokePreview = useCallback((url: string | null) => {
    if (url && url !== handedOffUrlRef.current) {
      URL.revokeObjectURL(url);
    }
  }, []);

  const resetState = useCallback(() => {
    setSelectedFile(null);
    revokePreview(previewUrlRef.current);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    setLoading(false);
    setPrompt(DEFAULT_PROMPT);
  }, [revokePreview]);

  useEffect(() => {
    if (!open) {
      resetState();
      handedOffUrlRef.current = null;
    }
  }, [open, resetState]);

  useEffect(() => () => {
    revokePreview(previewUrlRef.current);
  }, [revokePreview]);

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFile = (file: File) => {
    setError(null);
    const lower = (file.name || '').toLowerCase();
    const isValidImg =
      file.type.startsWith('image/') ||
      (file.type === '' && (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp')));
    if (!isValidImg) {
      setError('فقط فایل‌های تصویری (JPG، PNG، WebP) مجاز هستند.');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setError('حجم فایل تصویر نباید بیشتر از ۱۰ مگابایت باشد.');
      return;
    }
    revokePreview(previewUrlRef.current);
    setSelectedFile(file);
    const objUrl = URL.createObjectURL(file);
    setPreviewUrl(objUrl);
    setResult(null);
  };

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) handleFile(f);
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
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
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
      handedOffUrlRef.current = previewUrl;
      onApplyToChat?.(result, previewUrl, prompt);
      resetState();
      onClose();
    }
  };

  return (
    <Sheet open={open} onClose={handleClose} title="تحلیل بالینی تصویر پزشکی">
      <div className="aic-vision">
        <p className="aic-vision__intro">
          تصاویر رادیولوژی، پاتولوژی، نوار قلب (ECG) یا دیاگرام‌های آناتومیک را بارگذاری کنید تا هوش‌یار آن‌ها را تحلیل آموزشی کند.
        </p>

        {error && (
          <div className="notice notice--warn aic-vision__err" role="alert">
            <Icon name="i-alert-circle" size={16} />
            <span className="small">{error}</span>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={onFileInputChange}
        />

        {!previewUrl ? (
          <button
            type="button"
            className={`aic-vision__drop${dragActive ? ' is-drag' : ''}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="aic-vision__drop-icon" aria-hidden="true">
              <Icon name="i-upload" size={26} />
            </div>
            <div className="aic-vision__drop-title">انتخاب یا رها کردن تصویر بالینی</div>
            <p className="aic-vision__drop-hint">حداکثر ۱۰ مگابایت (JPG، PNG، WebP)</p>
          </button>
        ) : (
          <div className="aic-vision__stack">
            <div className="aic-vision__preview-card">
              <img
                src={previewUrl}
                alt="پیش‌نمایش بالینی"
                className="aic-vision__preview-img"
              />
              <div className="aic-vision__preview-actions">
                <DsButton
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    revokePreview(previewUrl);
                    setSelectedFile(null);
                    setPreviewUrl(null);
                    setResult(null);
                  }}
                  disabled={loading}
                >
                  تعویض تصویر
                </DsButton>
              </div>
            </div>

            <div className="aic-vision__field">
              <label htmlFor="aic-vision-prompt" className="aic-vision__label">
                دستورالعمل یا سؤال مد نظر برای این تصویر:
              </label>
              <textarea
                id="aic-vision-prompt"
                className="ds-input aic-vision__textarea"
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={loading}
              />
            </div>

            {!result && (
              <DsButton
                variant="primary"
                size="md"
                block
                disabled={loading}
                onClick={() => void handleAnalyze()}
              >
                {loading ? 'در حال تحلیل بالینی…' : 'شروع تحلیل تصویر'}
              </DsButton>
            )}
          </div>
        )}

        {result && (
          <div className="aic-vision__result">
            <div className="aic-vision__result-head">
              <div className="aic-vision__result-badge" aria-hidden="true">
                <Icon name="i-flask" size={18} />
              </div>
              <h3 className="aic-vision__result-title">تحلیل ساختارمند بالینی</h3>
              <Chip variant="cyan">آموزش پزشکی</Chip>
            </div>

            <div className="aic-vision__result-body">
              {result.analysis}
            </div>

            {result.detected_structures && result.detected_structures.length > 0 && (
              <div className="aic-vision__tags">
                <span className="aic-vision__meta">یافته‌ها و ساختارهای شناسایی‌شده:</span>
                <div className="aic-vision__tag-list">
                  {result.detected_structures.map((s, idx) => (
                    <Chip key={idx} variant="quiet">{s}</Chip>
                  ))}
                </div>
              </div>
            )}

            <div className="aic-vision__foot">
              <span className="aic-vision__meta num">
                توکن مصرفی: {result.tokens_used} · صرفاً کاربرد مرجع آموزشی
              </span>
              {onApplyToChat && (
                <DsButton variant="primary" size="sm" onClick={handleApply}>
                  انتقال به گفت‌وگو
                </DsButton>
              )}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
