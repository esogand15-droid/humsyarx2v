/* لایه داده کارنامه و معدل کل (Wave 6 Feature 36) */
import { apiCall } from './api';

export interface CourseGrade {
  course_id: string;
  name: string;
  credits: number | string;
  score: string | number;
  normalized_score: number | null;
  passed: boolean;
}

export interface SemesterTranscript {
  term_label: string;
  term_gpa: number | null;
  credits: number | string;
  courses: CourseGrade[];
}

export interface GradesSummaryPayload {
  cumulative_gpa: number | null;
  total_credits: number | string;
  passed_credits: number | string;
  failed_credits: number | string;
  semesters: SemesterTranscript[];
}

export const grades = {
  summary: () => apiCall<GradesSummaryPayload>('/grades/summary'),
};
