import { useEffect, useState } from 'react';
import { applyUpdate, onUpdateReady } from '../../lib/swUpdate';

/* 🧭 «نسخهٔ جدید آماده است» — غیرمسدودکننده؛ تا کاربر نزند، هیچ
   چیزی عوض نمیشود (وسط ویدیو یا آزمون صفحه تازه نمیشود). */
export default function UpdatePrompt() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => onUpdateReady(setReady), []);

  if (!ready || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        insetInline: 12,
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
        zIndex: 95,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 14,
        background: 'var(--bg-2, #111827)',
        color: 'var(--t-1, #fff)',
        border: '1px solid var(--bdg, rgba(255,255,255,.12))',
        boxShadow: '0 8px 28px rgba(0,0,0,.35)',
        maxWidth: 520,
        marginInline: 'auto',
        direction: 'rtl',
      }}
    >
      <span style={{ flex: 1, fontSize: 14, lineHeight: 1.6 }}>
        نسخهٔ جدید آماده است
      </span>
      <button
        type="button"
        onClick={applyUpdate}
        style={{
          minHeight: 40,
          padding: '0 14px',
          borderRadius: 10,
          border: 0,
          fontWeight: 700,
          background: 'var(--t-acc, #22d3ee)',
          color: '#04121a',
          cursor: 'pointer',
        }}
      >
        به‌روزرسانی
      </button>
      <button
        type="button"
        aria-label="بعداً"
        onClick={() => setDismissed(true)}
        style={{
          minWidth: 40,
          minHeight: 40,
          borderRadius: 10,
          border: 0,
          background: 'transparent',
          color: 'inherit',
          opacity: 0.7,
          cursor: 'pointer',
        }}
      >
        بعداً
      </button>
    </div>
  );
}
