import { ProtectedReaderView, type ProtectedReaderViewProps } from './ProtectedReaderView';

export interface PdfViewProps extends ProtectedReaderViewProps {
  url?: string;
}

/**
 * نمایشگر امن جزوات و فایل‌های PDF (موج Wave 4: Secure Protected WebP DRM Reader).
 *
 * فایل PDF اصلی هرگز به کلاینت فرستاده نمی‌شود؛ صفحات به‌صورت WebP واترمارک‌شده با توکن
 * کوتاه‌عمر HMAC و هدرهای no-store دریافت و در قالب ویوپورت پیوسته و مجازی نمایش داده می‌شوند.
 */
export function PdfView(props: PdfViewProps) {
  return <ProtectedReaderView {...props} />;
}

export { ProtectedReaderView };
