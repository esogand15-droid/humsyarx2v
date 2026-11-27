/* لایهٔ دادهٔ ریدر (موج P3).
   آدرسِ فایل، امضاشده و کوتاه‌عمر است (پیش‌فرض ۶ ساعت) و از سرور خودمان
   عبور می‌کند؛ توکن تلگرام هرگز به مرورگر نمی‌رسد. */
import { apiCall } from './api';

export type Scope = 'res' | 'ref';
export type Kind =
  | 'pdf'
  | 'video'
  | 'audio'
  | 'image'
  | 'slides'
  | 'document'
  | 'sheet'
  | 'archive'
  | 'attachment'
  | 'other';

export interface ViewInfo {
  id: string;
  name: string;
  mime: string;
  ext?: string;
  size: number;
  kind: Kind;
  available: boolean;
  reason?: string;
  url?: string;
  allow_download?: boolean;
  download_url?: string | null;
  expires_in?: number;
  /** epoch ثانیه (سرورهای جدید؛ افزوده) */
  expires_at?: number;
}

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  size_pt?: number;
  color?: string;
}

export interface SlideParagraph {
  rtl: boolean;
  align: string;
  lvl: number;
  bullet: string;
  runs: TextRun[];
  text: string;
}

export interface SlideTableCell {
  text: string;
  fill?: string | null;
  rtl: boolean;
}

export interface SlideElement {
  type: 'shape' | 'image' | 'table';
  x: number;
  y: number;
  w: number;
  h: number;
  shape?: string;
  fill?: string | null;
  stroke?: string | null;
  is_title?: boolean;
  paragraphs?: SlideParagraph[];
  asset?: string;
  supported?: boolean;
  ext?: string;
  rows?: SlideTableCell[][];
}

export interface SlideItem {
  index: number;
  title: string;
  bg_color?: string;
  bg_gradient?: string | null;
  bg_asset?: string | null;
  elements: SlideElement[];
  notes?: string;
}

export interface DocBlock {
  type: 'heading' | 'paragraph' | 'list_item' | 'table' | 'image';
  level?: number;
  rtl?: boolean;
  align?: string;
  text?: string;
  runs?: TextRun[];
  asset?: string;
  rows?: SlideTableCell[][];
}

export interface SheetTab {
  name: string;
  rows: string[][];
  truncated?: boolean;
}

export interface ArchiveEntry {
  name: string;
  size: number;
  compressed_size: number;
  is_dir: boolean;
  ext: string;
}

export interface OfficePayload {
  kind: Kind;
  format: string;
  scope?: string;
  file_id?: string;
  name?: string;
  mime?: string;
  ext?: string;
  size?: number;
  redirect_manifest?: string;
  aspect_ratio?: number;
  total_slides?: number;
  slides?: SlideItem[];
  blocks?: DocBlock[];
  text?: string;
  rtl?: boolean;
  truncated?: boolean;
  sheets?: SheetTab[];
  entries?: ArchiveEntry[];
  total_entries?: number;
  total_size?: number;
  is_legacy_binary?: boolean;
  asset_urls?: Record<string, string>;
  allow_download?: boolean;
  download_url?: string | null;
}

export interface Progress {
  page: number;
  total: number;
  position: number;
  updated_at: string | null;
}

export interface ContinueItem {
  scope: Scope;
  id: string;
  name: string;
  kind: Kind;
  page: number;
  total: number;
  position: number;
  percent: number;
  updated_at: string;
}

export const reader = {
  viewUrl: (scope: Scope, id: string) =>
    apiCall<ViewInfo>(`/library/view-url/${scope}/${encodeURIComponent(id)}`),

  office: (scope: Scope, id: string) =>
    apiCall<OfficePayload>(`/reader/office/${scope}/${encodeURIComponent(id)}`),

  progress: (scope: Scope, id: string) =>
    apiCall<Progress>(`/library/progress/${scope}/${encodeURIComponent(id)}`),

  save: (scope: Scope, id: string, body: { page: number; total: number; position: number; kind: Kind }) =>
    apiCall<{ ok: boolean }>(`/library/progress/${scope}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  recent: () => apiCall<{ items: ContinueItem[] }>('/library/continue'),
};

export interface ReportReason {
  key: string;
  label: string;
}

export interface MyReportItem {
  id: string | number;
  target_type: string;
  reason: string;
  note: string;
  status: string;
  status_label: string;
  created_at: string | null;
}

export const reportsApi = {
  reasons: () => apiCall<{ reasons: ReportReason[] }>('/api/reports/reasons'),
  submit: (body: { target_type: 'question' | 'resource'; target_id: string; reason: string; note?: string }) =>
    apiCall<{ ok: boolean; message?: string }>('/api/reports', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  mine: () => apiCall<{ reports: MyReportItem[] }>('/api/reports/my'),
};

/** نشانی ریدر برای یک فایل — یک‌جا، تا لینک‌ها از هم جدا نشوند. */
export function readerPath(scope: Scope, id: string): string {
  return `/read/${scope}/${encodeURIComponent(id)}`;
}
