import type { IconName } from '../icons/sprite';
import { sectionFor, tabSectionFor } from './section';
import type { DsSection } from '../design/components';

export interface NavEntry {
  to: string;
  label: string;
  shortLabel: string;
  icon: IconName;
  section: DsSection;
}

export const SIDEBAR_ITEMS: ReadonlyArray<NavEntry> = [
  { to: '/', label: 'خانه', shortLabel: 'خانه', icon: 'i-home', section: 'brand' },
  { to: '/library', label: 'کتابخانه', shortLabel: 'کتابخانه', icon: 'i-book', section: 'resources' },
  { to: '/exam', label: 'بانک سؤال', shortLabel: 'آزمون', icon: 'i-flask', section: 'qbank' },
  { to: '/ai', label: 'هوشیار', shortLabel: 'هوشیار', icon: 'i-chat', section: 'ai' },
  { to: '/grades', label: 'کارنامه و معدل', shortLabel: 'کارنامه', icon: 'i-award', section: 'grades' },
  { to: '/schedule', label: 'برنامه مطالعه', shortLabel: 'برنامه', icon: 'i-calendar', section: 'schedule' },
  { to: '/me/notes', label: 'دفترچه من', shortLabel: 'دفترچه', icon: 'i-pen', section: 'notes' },
  { to: '/me', label: 'پروفایل و حساب', shortLabel: 'حساب', icon: 'i-user', section: 'brand' },
];

export const TAB_ITEMS: ReadonlyArray<NavEntry> = [
  { to: '/', label: 'خانه', shortLabel: 'خانه', icon: 'i-home', section: tabSectionFor('/') },
  { to: '/library', label: 'کتابخانه', shortLabel: 'کتابخانه', icon: 'i-book', section: tabSectionFor('/library') },
  { to: '/exam', label: 'بانک سؤال', shortLabel: 'آزمون', icon: 'i-flask', section: tabSectionFor('/exam') },
  { to: '/schedule', label: 'برنامه', shortLabel: 'برنامه', icon: 'i-calendar', section: tabSectionFor('/schedule') },
  { to: '/me', label: 'من', shortLabel: 'من', icon: 'i-user', section: tabSectionFor('/me') },
];

export const ROUTE_TITLES: Record<string, string> = {
  '/': 'داشبورد دانشجو',
  '/library': 'کتابخانه آموزشی',
  '/exam': 'بانک سؤال و آزمون',
  '/ai': 'دستیار هوشیار',
  '/grades': 'کارنامه و معدل کل',
  '/schedule': 'برنامه مطالعه',
  '/me/notes': 'دفترچه من',
  '/me': 'پروفایل و حساب کاربری',
  '/subscription': 'طرح‌های اشتراک',
  '/tickets': 'پشتیبانی و تیکت‌ها',
  '/search': 'جستجوی سراسری',
  '/notifications': 'مرکز اعلان‌ها',
};

export function activeTabIndex(pathname: string): number {
  if (pathname === '/' || pathname === '/login') return 0;
  return TAB_ITEMS.findIndex(
    (t) => t.to !== '/' && (pathname === t.to || pathname.startsWith(`${t.to}/`)),
  );
}

export function fallbackTitleFor(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  if (pathname.startsWith('/exam/')) return 'بانک سؤال و آزمون';
  if (pathname.startsWith('/ai/')) return 'دستیار هوشیار';
  if (pathname.startsWith('/tickets/')) return 'پشتیبانی و تیکت‌ها';
  return '';
}

export { sectionFor };
