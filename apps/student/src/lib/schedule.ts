/* لایهٔ دادهٔ برنامهٔ هفتگی (موج P2) */
import { apiCall } from './api';

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
  days_left: number | null;
}

export interface SchedulePayload {
  items?: ScheduleItem[];
  schedule?: ScheduleItem[];
  group?: string;
  computed_group?: string;
  educational_group?: string;
  has_custom_selection?: boolean;
  selected_count?: number;
  total_offered_count?: number;
  term?: string;
}

export const schedule = {
  list: (days = 7) =>
    apiCall<SchedulePayload>(`/schedule?days=${days}`),
};

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
