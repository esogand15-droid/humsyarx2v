/* لایهٔ دادهٔ کتابخانه (موج P2) — هر شکل داده دقیقاً همان چیزی است که
   هندلرهای موجود مینی‌اپ برمی‌گردانند؛ هیچ فیلدی این‌جا ساخته نمی‌شود. */
import { apiCall } from './api';

export interface TermItem {
  name: string;
  lesson_count: number;
}

export interface LessonItem {
  _id: string;
  name: string;
  teacher: string;
  term: string;
  session_count: number;
}

export interface SessionItem {
  _id: string;
  number: number;
  topic: string;
  teacher: string;
  file_count: number;
  logical_id: string;
}

export type FileKind = 'video' | 'ppt' | 'pdf' | 'note' | 'test' | 'voice' | 'file' | string;

export interface ContentFile {
  id: string;
  type: FileKind;
  name: string;
  description: string;
  downloads: number;
  mime: string;
  size: number;
  preview: boolean;
  lesson?: string;
  session?: string;
}

export interface SubjectItem {
  id: string;
  name: string;
  book_count: number;
}

export interface BookItem {
  id: string;
  name: string;
  fa_count: number;
  en_count: number;
}

export interface ReferenceFile {
  id: string;
  lang: 'fa' | 'en';
  volume: number;
  description: string;
  downloads: number;
  mime: string;
  size: number;
  preview: boolean;
}

export interface GateState {
  allowed: boolean;
  code: string | null;
  message: string;
  status?: number;
}

export interface LibraryState {
  resources: GateState;
  references: GateState;
  intake: string;
  group: string;
}

export const library = {
  state: () => apiCall<LibraryState>('/library/state'),

  terms: () => apiCall<{ terms: TermItem[] }>('/library/terms'),

  lessons: (term: string) =>
    apiCall<{ lessons: LessonItem[] }>(`/library/lessons/${encodeURIComponent(term)}`),

  sessions: (lessonId: string) =>
    apiCall<{ sessions: SessionItem[] }>(`/library/sessions/${encodeURIComponent(lessonId)}`),

  files: (sessionId: string) =>
    apiCall<{ files: ContentFile[] }>(`/library/files/${encodeURIComponent(sessionId)}`),

  search: (q: string) =>
    apiCall<{ results: ContentFile[] }>(`/library/search?q=${encodeURIComponent(q)}`),

  subjects: () => apiCall<{ subjects: SubjectItem[] }>('/library/subjects'),

  books: (subjectId: string) =>
    apiCall<{ subject: { id: string; name: string }; books: BookItem[] }>(
      `/library/books/${encodeURIComponent(subjectId)}`,
    ),

  bookFiles: (bookId: string) =>
    apiCall<{ book: { id: string; name: string }; fa_files: ReferenceFile[]; en_files: ReferenceFile[] }>(
      `/library/book-files/${encodeURIComponent(bookId)}`,
    ),
};

/** برچسب فارسی نوع فایل — یکپارچه برای کل اپلیکیشن وب. */
export const FILE_LABEL: Record<string, string> = {
  video: 'ویدیو کلاس',
  ppt: 'اسلاید پاورپوینت',
  pptx: 'اسلاید پاورپوینت',
  slides: 'اسلایدها',
  pdf: 'جزوه PDF',
  doc: 'سند متنی / ورد',
  docx: 'سند ورد',
  xls: 'فایل اکسل',
  xlsx: 'فایل اکسل',
  zip: 'فایل فشرده',
  note: 'نکات',
  test: 'تست',
  voice: 'ویس استاد',
  file: 'فایل ضمیمه',
};

export function fileLabel(kind: string, mime?: string, name?: string): string {
  const m = (mime || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (kind === 'ppt' || m.includes('presentation') || m.includes('powerpoint') || /\.(pptx?|ppsx?|odp)$/.test(n)) {
    return 'اسلاید پاورپوینت';
  }
  if (m.includes('wordprocessing') || m.includes('msword') || /\.(docx?|rtf)$/.test(n)) {
    return 'سند ورد';
  }
  if (m.includes('spreadsheet') || m.includes('ms-excel') || /\.(xlsx?|csv)$/.test(n)) {
    return 'جدول / اکسل';
  }
  if (m.includes('zip') || /\.(zip|rar|7z)$/.test(n)) {
    return 'فایل فشرده';
  }
  return FILE_LABEL[kind] ?? FILE_LABEL.file;
}

/** حجم خوانا — بدون اعشار الکی، بدون صفر پیشرو. */
export function humanSize(bytes: number): string {
  if (!bytes || bytes < 0) return '';
  const units = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString('fa-IR')} ${units[unit]}`;
}

/** عدد فارسی بدون ارقام لاتین. */
export function fa(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return value.toLocaleString('fa-IR');
  }
  return String(value).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}
