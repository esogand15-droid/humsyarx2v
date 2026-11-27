/** نوار پیشرفت DS v2 — SVG راست‌چین با گوشه‌های گرد بدون کشیدگی. */
export function ProgressBar({
  value,
  thin = false,
  tone = 'accent',
}: {
  value: number;
  thin?: boolean;
  tone?: 'accent' | 'good' | 'warn' | 'danger';
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const fillTone = tone === 'accent' ? '' : ` ds-progress__fill--${tone}`;
  return (
    <div
      className={`ds-progress${thin ? ' ds-progress--thin' : ''}`}
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg className="ds-progress__svg" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
        <rect className={`ds-progress__fill${fillTone}`} x={100 - v} y={0} width={v} height={8} rx={0} />
      </svg>
    </div>
  );
}
