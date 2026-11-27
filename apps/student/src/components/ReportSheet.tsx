import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { Toast } from './Toast';
import { DsButton, DsChip } from '../design/components';
import { Icon } from '../icons';
import { errorText } from '../lib/api';
import { reportsApi, type ReportReason } from '../lib/reader';

export interface ReportSheetProps {
  open: boolean;
  onClose: () => void;
  targetType: 'question' | 'resource';
  targetId: string;
  targetLabel?: string;
}

const DEFAULT_REASONS: ReportReason[] = [
  { key: 'wrong_answer', label: 'پاسخ اشتباه' },
  { key: 'wrong_option', label: 'گزینه اشتباه' },
  { key: 'incomplete', label: 'متن یا محتوا ناقص' },
  { key: 'broken_file', label: 'فایل خراب یا ناخوانا' },
  { key: 'outdated', label: 'محتوا قدیمی است' },
  { key: 'other', label: 'سایر موارد' },
];

export function ReportSheet({ open, onClose, targetType, targetId, targetLabel }: ReportSheetProps) {
  const [reasons, setReasons] = useState<ReportReason[]>(DEFAULT_REASONS);
  const [reason, setReason] = useState<string>('incomplete');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason(targetType === 'resource' ? 'broken_file' : 'wrong_answer');
    setNote('');
    reportsApi
      .reasons()
      .then((res) => {
        if (res.reasons?.length) setReasons(res.reasons);
      })
      .catch(() => {});
  }, [open, targetType]);

  const submit = async () => {
    if (!targetId || busy) return;
    setBusy(true);
    try {
      const res = await reportsApi.submit({
        target_type: targetType,
        target_id: targetId,
        reason,
        note: note.trim(),
      });
      setToast(res.message || 'گزارش با موفقیت ثبت شد.');
      window.setTimeout(() => {
        setToast(null);
        onClose();
      }, 900);
    } catch (e) {
      setToast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title="گزارش ایراد محتوا" size="compact">
        <div className="core-stack">
          {targetLabel && (
            <p className="small muted" style={{ margin: 0 }}>
              مورد انتخاب‌شده: <strong>{targetLabel}</strong>
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {reasons.map((r) => (
              <DsChip key={r.key} selected={reason === r.key} onClick={() => setReason(r.key)}>
                {r.label}
              </DsChip>
            ))}
          </div>
          <div>
            <label className="small muted" htmlFor="report-note-input" style={{ display: 'block', marginBottom: 6 }}>
              توضیح تکمیلی (اختیاری)
            </label>
            <textarea
              id="report-note-input"
              className="ds-input"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="مشکل دقیق اسلاید، فایل یا سؤال را بنویسید…"
              style={{ width: '100%', resize: 'vertical', fontSize: 15 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <DsButton variant="ghost" onClick={onClose} disabled={busy}>
              انصراف
            </DsButton>
            <DsButton variant="primary" loading={busy} onClick={() => void submit()}>
              <Icon name="i-alert-circle" size={16} />
              ثبت گزارش
            </DsButton>
          </div>
        </div>
      </Sheet>
      <Toast message={toast} />
    </>
  );
}
