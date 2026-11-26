import { useState } from 'react';

export type BrandSize = 'sm' | 'md' | 'lg' | 'xl';
export type BrandVariant = 'app-icon' | 'emblem';

const PX: Record<BrandSize, number> = { sm: 34, md: 44, lg: 64, xl: 84 };

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

  // مسیر از base بیلد (/student/) ساخته می‌شود، نه نسبی: در مسیرهای تودرتو
  // مثل /me/notes آدرس نسبی به /student/me/… می‌رسید و ۴۰۴ می‌داد.
  const base = (import.meta.env.BASE_URL || '/student/').replace(/\/?$/, '/');
  const stem = variant === 'emblem' ? 'brand-emblem-transparent' : 'brand-app-icon';
  const [fbStep, setFbStep] = useState<0 | 1 | 2>(0);

  const webpSrc = `${base}${stem}.webp`;
  const pngSrc =
    fbStep === 0 ? `${base}${stem}.png` : fbStep === 1 ? `/student/${stem}.png` : `${base}brand-logo.png`;

  return (
    <div
      className={`mark mark--brand mark--brand--${size} mark--brand--${variant} ${className}`.trim()}
      style={style}
      role="img"
      aria-label="هامزیار"
    >
      <picture className="mark--brand__pic">
        {fbStep === 0 && <source srcSet={webpSrc} type="image/webp" />}
        <img
          className="mark--brand__img"
          src={pngSrc}
          alt="HumsYar"
          width={px}
          height={px}
          decoding="async"
          onError={() => {
            setFbStep((s) => (s < 2 ? ((s + 1) as 1 | 2) : s));
          }}
        />
      </picture>
    </div>
  );
}
