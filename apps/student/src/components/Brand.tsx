export type BrandSize = 'sm' | 'md' | 'lg' | 'xl';
export type BrandVariant = 'app-icon' | 'emblem';

const PX: Record<BrandSize, number> = { sm: 34, md: 44, lg: 64, xl: 84 };
const R: Record<BrandSize, number> = { sm: 9, md: 12, lg: 18, xl: 24 };

interface BrandProps {
  size?: BrandSize;
  variant?: BrandVariant;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * نشان رسمی برند هامزیار (HumsYar Official Brand Emblem & App Icon).
 *
 * ترکیب نمادین:
 * ۱) کتاب چندلایه پزشکی و راهنمای جامع بالینی در پایه.
 * ۲) عصای زرین هرمس (Caduceus) با بال‌های گشوده و مارهای درهم‌تنیده در مرکز.
 * ۳) مغز دوگانه سینرژیک (نیم‌کره چپ: نورون‌های بیولوژیک مغز انسان / نیم‌کره راست: مدارهای نئونی هوش مصنوعی).
 */
export function Brand({
  size = 'md',
  variant = 'app-icon',
  className = '',
  style,
}: BrandProps) {
  const px = PX[size];
  const r = R[size];

  // مسیر از base بیلد (/student/) ساخته می‌شود، نه نسبی: در مسیرهای تودرتو
  // مثل /me/notes آدرس نسبی به /student/me/… می‌رسید و ۴۰۴ می‌داد.
  const base = (import.meta.env.BASE_URL || '/student/').replace(/\/?$/, '/');
  const primarySrc =
    variant === 'emblem' ? `${base}brand-emblem-transparent.png` : `${base}brand-app-icon.png`;
  const fallbackSrc =
    variant === 'emblem'
      ? '/student/brand-emblem-transparent.png'
      : '/student/brand-app-icon.png';
  const legacyFallback = `${base}brand-logo.png`;

  return (
    <div
      className={`mark mark--brand ${className}`}
      style={{
        width: px,
        height: px,
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        filter:
          variant === 'emblem'
            ? 'drop-shadow(0 2px 8px rgba(0, 242, 254, 0.25))'
            : 'drop-shadow(0 3px 10px rgba(0, 242, 254, 0.3))',
        transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), filter 0.2s ease',
        ...style,
      }}
      role="img"
      aria-label="هامزیار"
    >
      <img
        src={primarySrc}
        alt="HumsYar"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          borderRadius: variant === 'app-icon' ? r : undefined,
          imageRendering: 'auto',
        }}
        onError={(e) => {
          const img = e.currentTarget as HTMLImageElement;
          if (img.src !== fallbackSrc && !img.src.endsWith(fallbackSrc)) {
            img.src = fallbackSrc;
          } else {
            img.src = legacyFallback;
          }
        }}
      />
    </div>
  );
}
