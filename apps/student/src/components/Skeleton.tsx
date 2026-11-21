/** اسکلت بارگذاری سبک و با شیمر GPU نرم */
export function Skeleton({
  variant = 'text',
  width,
  shimmer = true,
}: {
  variant?: 'text' | 'card' | 'row';
  width?: string;
  shimmer?: boolean;
}) {
  const cls = [
    'skeleton',
    variant === 'card' && 'skeleton--card',
    variant === 'row' && 'skeleton--row',
    shimmer && 'skeleton--shimmer',
  ]
    .filter(Boolean)
    .join(' ');
  return <div className={cls} style={width ? { width } : undefined} aria-hidden="true" />;
}

export function SkeletonStack({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant={i === 0 ? 'card' : 'row'} />
      ))}
    </div>
  );
}
