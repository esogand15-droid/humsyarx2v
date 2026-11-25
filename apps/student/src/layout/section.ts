import type { DsSection } from '../design/components';

/** Route → DS v2 section role (docs/design/DS_V2.md §4.3). The shell puts it on <main data-section>,
    so every .ds-* component and the v1 --brand* aliases inside a screen pick up its accent. */
const RULES: ReadonlyArray<[prefix: string, section: DsSection]> = [
  ['/me/notes', 'notes'],
  ['/library', 'resources'],
  ['/read/', 'resources'],
  ['/exam', 'qbank'],
  ['/schedule', 'schedule'],
  ['/ai', 'ai'],
  ['/grades', 'grades'],
  ['/subscription', 'money'],
];

export function sectionFor(pathname: string): DsSection {
  for (const [prefix, section] of RULES) {
    if (pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`) || pathname === prefix.replace(/\/$/, '')) {
      return section;
    }
  }
  return 'brand';
}

/** Which bottom tab owns a route (the tab bar only has five first-level areas). */
export function tabSectionFor(to: string): DsSection {
  return to === '/' || to === '/me' ? 'brand' : sectionFor(to);
}
