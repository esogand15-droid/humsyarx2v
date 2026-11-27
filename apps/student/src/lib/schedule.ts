/* لایهٔ دادهٔ برنامهٔ هفتگی (موج P2 · بازنگری DS v2 در موج W3C) */
import { apiCall } from './api';
import { formatTerm } from './fa';
import { tehranNow, weekStart } from './weekPlan';

export interface ScheduleItem {
  id: string;
  type: 'class' | 'exam' | 'makeup';
  lesson: string;
  teacher: string;
  date: string;
  time: string;
  end_time: string;
  location: string;
  note: string;
  group: string;
  educational_group: string;
  course_code: string;
  term: string;
  flex_type?: string;
  flex_note?: string;
  days_left: number | null;
}

export interface ScheduleConflict {
  lesson_a?: string;
  group_a?: string;
  time_a?: string;
  lesson_b?: string;
  group_b?: string;
  time_b?: string;
  day_label?: string;
  date?: string;
  type?: string;
  message?: string;
}

export interface SchedulePayload {
  items?: ScheduleItem[];
  schedule?: ScheduleItem[];
  group?: string;
  computed_group?: string;
  registered_group?: string;
  educational_group?: string;
  educational_group_info?: { ai_suggested_group?: string };
  needs_educational_group_confirmation?: boolean;
  mismatched_selections?: Array<{ lesson?: string; reason?: string }>;
  has_custom_selection?: boolean;
  selected_count?: number;
  total_offered_count?: number;
  unselected_lessons?: string[];
  conflicts?: ScheduleConflict[];
  term?: string;
}

export interface CourseOfferingGroup {
  group: string;
  teacher?: string;
}

export interface CourseOffering {
  lesson: string;
  credit?: number;
  single_group?: boolean;
  auto_selected_group?: string;
  groups?: CourseOfferingGroup[];
}

export interface CourseSelectionsPayload {
  term?: string;
  registered_group?: string;
  computed_group?: string;
  educational_group?: string;
  educational_group_info?: { ai_suggested_group?: string };
  needs_educational_group_confirmation?: boolean;
  has_selections?: boolean;
  selections_map?: Record<string, string>;
  offerings?: CourseOffering[];
  mismatched_selections?: Array<{ lesson?: string }>;
}

export interface ScheduleQueryOptions {
  since?: string;
  stype?: string;
}

function normalizePayload(res: SchedulePayload): SchedulePayload {
  const rawItems = Array.isArray(res.schedule)
    ? res.schedule
    : Array.isArray(res.items)
      ? res.items
      : [];
  const items = rawItems.map((it) => ({
    ...it,
    term: formatTerm(it.term),
  }));
  return {
    ...res,
    items,
    schedule: items,
    selected_count: Number(res.selected_count ?? 0),
    total_offered_count: Number(res.total_offered_count ?? 0),
    has_custom_selection: Boolean(res.has_custom_selection),
    conflicts: Array.isArray(res.conflicts) ? res.conflicts : [],
    term: formatTerm(res.term),
    group: res.group || res.computed_group || '',
    computed_group: res.computed_group || res.group || '',
    educational_group: res.educational_group || '',
  };
}

export const schedule = {
  list: async (opts?: number | ScheduleQueryOptions): Promise<SchedulePayload> => {
    let qs = '';
    if (typeof opts === 'number') {
      qs = `?days=${encodeURIComponent(String(opts))}`;
    } else {
      const params = new URLSearchParams();
      const since = opts?.since !== undefined
        ? opts.since
        : (!opts?.stype ? weekStart(tehranNow().iso) : '');
      if (since) params.set('since', since);
      if (opts?.stype) params.set('stype', opts.stype);
      const encoded = params.toString();
      if (encoded) qs = `?${encoded}`;
    }
    const res = await apiCall<SchedulePayload>(`/schedule${qs}`);
    return normalizePayload(res);
  },

  courseSelections: () => apiCall<CourseSelectionsPayload>('/schedule/course-selections'),

  saveCourseSelections: (body: { selections: Array<{ lesson: string; group: string }>; term?: string; educational_group?: 'male' | 'female' }) =>
    apiCall<{ ok?: boolean; computed_group?: string; selected_count?: number }>('/schedule/course-selections', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  setEducationalGroup: (educational_group: 'male' | 'female') =>
    apiCall<{ ok?: boolean }>('/api/profile/educational-group', {
      method: 'PATCH',
      body: JSON.stringify({ educational_group }),
    }),
};

export async function downloadScheduleBlob(kind: 'ical' | 'pdf'): Promise<void> {
  const url = kind === 'pdf' ? '/api/web/schedule/pdf' : '/api/web/schedule/ical';
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const obj = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = obj;
  a.download = kind === 'pdf' ? 'humsyar-schedule.pdf' : 'humsyar-schedule.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(obj), 4000);
}

/* تسک‌های مطالعه شخصی تقویم جلالی (Wave 6 Feature 35) */
export interface StudyTask {
  task_id: string;
  title: string;
  jalali_date: string;
  reminder_time: string | null;
  completed: boolean;
  completed_at: string | null;
}

export interface StudyTasksPayload {
  tasks: StudyTask[];
}

export const studyTasks = {
  list: (from_jalali?: string, to_jalali?: string) => {
    const params = new URLSearchParams();
    if (from_jalali) params.set('from_jalali', from_jalali);
    if (to_jalali) params.set('to_jalali', to_jalali);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return apiCall<StudyTasksPayload>(`/schedule/items${qs}`);
  },

  create: (data: { title: string; jalali_date: string; reminder_time?: string | null }) =>
    apiCall<{ task_id: string; created: boolean }>('/schedule/items', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  toggle: (task_id: string) =>
    apiCall<{ task_id: string; completed: boolean; completed_at: string | null }>(
      `/schedule/items/${encodeURIComponent(task_id)}/toggle`,
      { method: 'PATCH' },
    ),
};
