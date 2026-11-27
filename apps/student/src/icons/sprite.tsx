/* ═══════════════════════════════════════════════════════
   اسپرایت آیکون‌ها — ۳۴ آیکون اختصاصی + نشانهٔ برند
   شبکهٔ ۲۴×۲۴ · استروک ۱.۷ · fill:none · currentColor
   منبع: نمونهٔ تأییدشدهٔ «مرکب» (design-system/03-components)
   ═══════════════════════════════════════════════════════ */

export const ICON_NAMES = [
  'logo-mark',
  'i-arch',
  'i-home',
  'i-book',
  'i-flask',
  'i-calendar',
  'i-user',
  'i-bell',
  'i-chat',
  'i-card',
  'i-search',
  'i-headphones',
  'i-video',
  'i-doc',
  'i-download',
  'i-upload',
  'i-bookmark',
  'i-pen',
  'i-highlighter',
  'i-eraser',
  'i-chevron',
  'i-chevron-r',
  'i-check',
  'i-lock',
  'i-settings',
  'i-clock',
  'i-play',
  'i-grid',
  'i-logout',
  'i-trend',
  'i-layers',
  'i-code',
  'i-copy',
  'i-moon',
  'i-sun',
  'i-book-open',
  'i-target',
  'i-award',
  'i-alert-circle',
  'i-file-text',
  'i-help-circle',
  'i-message-circle',
  'i-smartphone',
  'i-credit-card',
  'i-shield',
  'i-info',
  'i-x',
  'i-log-out',
  // W3 هوشیار
  'i-plus',
  'i-refresh',
  'i-stop',
  'i-send',
  'i-more',
  'i-trash',
  'i-pin',
  'i-menu',
  'i-arrow-down',
  // DS v2 icons (replaces emoji chrome)
  'i-flame',
  'i-pencil',
  'i-fountain',
  'i-lasso',
  'i-shapes',
  'i-expand',
  'i-arrow-up',
  'i-arrow-left',
  'i-arrow-right',
  'i-palette',
  'i-scissors',
  'i-star',
  'i-star-filled',
  'i-stethoscope',
  'i-zap',
  'i-pill',
  'i-hand',
  'i-eye',
  'i-eye-off',
  'i-tablet',
  'i-monitor',
  'i-trophy',
  'i-heart',
  'i-graduation',
  'i-notebook',
  'i-wallet',
  'i-inbox',
  'i-sliders',
  'i-lifebuoy',
  'i-flag',
  'i-pencil-ruler',
  'i-mic',
  'i-mic-off',
  'i-waveform',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** یک‌بار در ریشهٔ اپ رندر می‌شود؛ همهٔ آیکون‌ها با <use href="#id"> از آن می‌آیند. */
export function IconSprite() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="svg-sprite-defs">
      <symbol id="logo-mark" viewBox="0 0 24 24">
      <path d="M12 12.4c-2.3-1.3-5-1.6-7.7-.8v7.1c2.7-.8 5.4-.5 7.7.8 2.3-1.3 5-1.6 7.7-.8V11.6c-2.7-.8-5.4-.5-7.7.8z"
      fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"/>
      <path d="M12 4.2v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="12" cy="3.3" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M9.2 7.4c1.7-1 3.9-1 5.6 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      </symbol>
      <symbol id="i-arch" viewBox="0 0 24 24"><path d="M5.2 19V10.7a6.8 6.8 0 0 1 13.6 0V19"/><path d="M3.2 19h17.6"/><path d="M10.2 14.6h3.6"/></symbol>
      <symbol id="i-home" viewBox="0 0 24 24"><path d="M4.6 19.4V11a7.4 7.4 0 0 1 14.8 0v8.4"/><path d="M3 19.4h18"/><path d="M9.6 19.4v-4.2a2.4 2.4 0 0 1 4.8 0v4.2"/></symbol>
      <symbol id="i-book" viewBox="0 0 24 24"><path d="M4 5.4h5.4A2.6 2.6 0 0 1 12 8v12a2.4 2.4 0 0 0-2.4-2.4H4z"/><path d="M20 5.4h-5.4A2.6 2.6 0 0 0 12 8v12a2.4 2.4 0 0 1 2.4-2.4H20z"/></symbol>
      <symbol id="i-flask" viewBox="0 0 24 24"><path d="M9.2 3.2h5.6"/><path d="M10.1 3.2v6.1L5.7 17a3 3 0 0 0 2.6 4.4h7.4a3 3 0 0 0 2.6-4.4l-4.4-7.7V3.2"/><path d="M7.6 14.6h8.8"/></symbol>
      <symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3.4" y="5.4" width="17.2" height="15.2" rx="3"/><path d="M3.4 10.4h17.2"/><path d="M8.2 3.4v4M15.8 3.4v4"/><path d="M7.6 14.2h2.2M14.2 14.2h2.2M7.6 17.4h2.2"/></symbol>
      <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8.4" r="3.8"/><path d="M4.8 20.2c.8-3.6 3.7-5.6 7.2-5.6s6.4 2 7.2 5.6"/></symbol>
      <symbol id="i-bell" viewBox="0 0 24 24"><path d="M6.6 16.6V11a5.4 5.4 0 0 1 10.8 0v5.6"/><path d="M4.4 16.6h15.2"/><path d="M9.9 19.9a2.1 2.1 0 0 0 4.2 0"/></symbol>
      <symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 6.6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6.8a3 3 0 0 1-3 3h-4.6L7.2 20.5v-4.1H7a3 3 0 0 1-3-3z"/></symbol>
      <symbol id="i-card" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M3 10.4h18"/><path d="M6.4 15h3.2"/></symbol>
      <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.2"/><path d="M15.6 15.6 20.2 20.2"/></symbol>
      <symbol id="i-headphones" viewBox="0 0 24 24"><path d="M4.6 15.2v-3.4a7.4 7.4 0 0 1 14.8 0v3.4"/><rect x="2.8" y="14" width="4" height="6.2" rx="2"/><rect x="17.2" y="14" width="4" height="6.2" rx="2"/></symbol>
      <symbol id="i-video" viewBox="0 0 24 24"><rect x="3" y="6.6" width="12.4" height="10.8" rx="2.6"/><path d="m15.4 11.6 5.6-2.9v6.6l-5.6-2.9z"/></symbol>
      <symbol id="i-doc" viewBox="0 0 24 24"><path d="M6.2 4.6a2 2 0 0 1 2-2h5.4L19 8v11.4a2 2 0 0 1-2 2H8.2a2 2 0 0 1-2-2z"/><path d="M13.6 2.7V8H19"/><path d="M9 12.4h6M9 15.9h4"/></symbol>
      <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 3.6v10"/><path d="m8 9.8 4 4 4-4"/><path d="M4.6 16.8v1.6a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-1.6"/></symbol>
      <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 20.4V10.4"/><path d="m8 14.2 4-4 4 4"/><path d="M4.6 7.2V5.6a2 2 0 0 1 2-2h10.8a2 2 0 0 1 2 2v1.6"/></symbol>
      <symbol id="i-bookmark" viewBox="0 0 24 24"><path d="M7 3.6h10a1.4 1.4 0 0 1 1.4 1.4v16L12 16.9 5.6 21V5A1.4 1.4 0 0 1 7 3.6z"/></symbol>
      <symbol id="i-pen" viewBox="0 0 24 24"><path d="M15.6 3.9a2 2 0 0 1 2.85 0l1.65 1.65a2 2 0 0 1 0 2.85L9.5 19.1l-4.6 1.4 1.4-4.6z"/><path d="m14.1 5.4 4.5 4.5"/></symbol>
      <symbol id="i-highlighter" viewBox="0 0 24 24"><path d="m6 14.4 8.8-8.8a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L9.6 18"/><path d="M4 21h8"/><path d="m6 14.4 3.6 3.6"/></symbol>
      <symbol id="i-eraser" viewBox="0 0 24 24"><path d="M8.4 19.6 3.9 15.1a2 2 0 0 1 0-2.8l7-7a2 2 0 0 1 2.8 0l4.4 4.4a2 2 0 0 1 0 2.8l-7.2 7.1z"/><path d="m8.1 9.6 6.4 6.4"/><path d="M8.4 19.6H20"/></symbol>
      <symbol id="i-chevron" viewBox="0 0 24 24"><path d="M14.4 5.6 8 12l6.4 6.4"/></symbol>
      <symbol id="i-chevron-r" viewBox="0 0 24 24"><path d="M9.6 5.6 16 12l-6.4 6.4"/></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="m4.6 12.4 5 5 9.8-10.8"/></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24"><rect x="4.6" y="10" width="14.8" height="10.4" rx="3"/><path d="M8.1 10V7.9a3.9 3.9 0 0 1 7.8 0V10"/></symbol>
      <symbol id="i-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v2.5M12 18.7v2.5M21.2 12h-2.5M5.3 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/></symbol>
      <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2"/><path d="M12 7.6V12l3 2"/></symbol>
      <symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5.4v13.2l10-6.6z"/></symbol>
      <symbol id="i-grid" viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></symbol>
      <symbol id="i-logout" viewBox="0 0 24 24"><path d="M13.6 20.4H6.6a2 2 0 0 1-2-2V5.6a2 2 0 0 1 2-2h7"/><path d="M10 12h10"/><path d="m16.6 8.4 3.6 3.6-3.6 3.6"/></symbol>
      <symbol id="i-trend" viewBox="0 0 24 24"><path d="M3.6 16.4 9 11l3.6 3.4 7.2-7.4"/><path d="M15.6 7h4.4v4.4"/></symbol>
      <symbol id="i-layers" viewBox="0 0 24 24"><path d="M12 3.4 3.8 7.6 12 11.8l8.2-4.2z"/><path d="m3.8 12.4 8.2 4.2 8.2-4.2"/><path d="m3.8 16.8 8.2 4.2 8.2-4.2"/></symbol>
      <symbol id="i-code" viewBox="0 0 24 24"><path d="m8.6 8-4 4 4 4"/><path d="m15.4 8 4 4-4 4"/></symbol>
      <symbol id="i-copy" viewBox="0 0 24 24"><rect x="8.4" y="8.4" width="12" height="12" rx="2.6"/><path d="M15.6 5.6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.6a2 2 0 0 0 2 2"/></symbol>
      <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.4A8 8 0 0 1 9.6 4 8.2 8.2 0 1 0 20 14.4z"/></symbol>
      <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/></symbol>
      <symbol id="i-book-open" viewBox="0 0 24 24"><path d="M2 3.6h6a3 3 0 0 1 3 3v12a2.4 2.4 0 0 0-2.4-2.4H2z"/><path d="M22 3.6h-6a3 3 0 0 0-3 3v12a2.4 2.4 0 0 1 2.4-2.4H22z"/></symbol>
      <symbol id="i-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></symbol>
      <symbol id="i-award" viewBox="0 0 24 24"><circle cx="12" cy="9" r="6"/><path d="M8.8 14.4l-1.4 7.2 4.6-2.4 4.6 2.4-1.4-7.2"/></symbol>
      <symbol id="i-alert-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></symbol>
      <symbol id="i-file-text" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/></symbol>
      <symbol id="i-help-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.2-1.8 2.5 2.5 0 0 1 .3 3.3 3 3 0 0 1-1 1c-.6.5-.8.8-.8 1.5"/><circle cx="12" cy="17" r=".5"/></symbol>
      <symbol id="i-message-circle" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5a8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></symbol>
      <symbol id="i-smartphone" viewBox="0 0 24 24"><rect x="6.5" y="2" width="11" height="20" rx="3"/><path d="M12 18h.01"/></symbol>
      <symbol id="i-hand" viewBox="0 0 24 24"><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/></symbol>
      <symbol id="i-credit-card" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/></symbol>
      <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></symbol>
      <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></symbol>
      <symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></symbol>
      <symbol id="i-log-out" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.6-4.6L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.6 4.6L20 16"/><path d="M20 20.5V16h-4.5"/></symbol>
      <symbol id="i-stop" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></symbol>
      <symbol id="i-send" viewBox="0 0 24 24"><path d="M12 19V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/></symbol>
      <symbol id="i-more" viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/></symbol>
      <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l.9 12.2a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8L17.5 7"/><path d="M10 11v6M14 11v6"/></symbol>
      <symbol id="i-pin" viewBox="0 0 24 24"><path d="M9 3.5h6l-1 6 3.5 3.5h-11L10 9.5z"/><path d="M12 13v7.5"/></symbol>
      <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 6.5h16M4 12h16M4 17.5h10"/></symbol>
      <symbol id="i-arrow-down" viewBox="0 0 24 24"><path d="M12 5v14"/><path d="m5.5 12.5 6.5 6.5 6.5-6.5"/></symbol>
      <symbol id="i-flame" viewBox="0 0 24 24"><path d="M12 2.8c.4 3.4-2.2 5.2-2.2 8.2a3.2 3.2 0 0 0 3.2 3.2 3.2 3.2 0 0 0 3-4.3c2.1 1.6 3.2 4 3.2 6.3a7.2 7.2 0 1 1-14.4 0c0-4 2.7-7.7 7.2-13.4z"/></symbol>
      <symbol id="i-pencil" viewBox="0 0 24 24"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/><path d="m14 6 4 4"/></symbol>
      <symbol id="i-fountain" viewBox="0 0 24 24"><path d="M12 3 8.2 10.5a4 4 0 0 0 .8 4.4L12 18l3-3.1a4 4 0 0 0 .8-4.4z"/><path d="M12 3v7"/><circle cx="12" cy="11.2" r="1"/><path d="M8.5 19.5h7"/></symbol>
      <symbol id="i-lasso" viewBox="0 0 24 24"><path d="M11 4.5c4.7 0 8.5 2.7 8.5 6s-3.8 6-8.5 6-8.5-2.7-8.5-6 3.8-6 8.5-6z" strokeDasharray="3 2.5"/><path d="M8.5 16.2c-.8 1.3-.8 2.8.3 3.8 1.2 1 3 .6 3.5-.8.4-1.2-.3-2.5-1.6-2.8"/></symbol>
      <symbol id="i-shapes" viewBox="0 0 24 24"><circle cx="8" cy="15.5" r="4.2"/><rect x="13" y="11.5" width="7.2" height="7.2" rx="1.4"/><path d="m12 3.5 4.2 6.8H7.8z"/></symbol>
      <symbol id="i-expand" viewBox="0 0 24 24"><path d="M8.5 3.5H4.5a1 1 0 0 0-1 1v4"/><path d="M15.5 3.5h4a1 1 0 0 1 1 1v4"/><path d="M8.5 20.5H4.5a1 1 0 0 1-1-1v-4"/><path d="M15.5 20.5h4a1 1 0 0 0 1-1v-4"/></symbol>
      <symbol id="i-arrow-up" viewBox="0 0 24 24"><path d="M12 19V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/></symbol>
      <symbol id="i-arrow-left" viewBox="0 0 24 24"><path d="M19 12H5"/><path d="m11.5 5.5-6.5 6.5 6.5 6.5"/></symbol>
      <symbol id="i-arrow-right" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12.5 5.5 6.5 6.5-6.5 6.5"/></symbol>
      <symbol id="i-palette" viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0 0 18 1.6 1.6 0 0 0 1.6-1.6c0-.4-.2-.8-.4-1.1a1.5 1.5 0 0 1 1.2-2.4H16a5 5 0 0 0 5-5c0-4.4-4-8.9-9-8.9z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/></symbol>
      <symbol id="i-scissors" viewBox="0 0 24 24"><circle cx="6.5" cy="7" r="2.6"/><circle cx="6.5" cy="17" r="2.6"/><path d="M8.8 8.6 19.5 16"/><path d="M8.8 15.4 19.5 8"/></symbol>
      <symbol id="i-star" viewBox="0 0 24 24"><path d="m12 3.2 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.6l6-.9z"/></symbol>
      <symbol id="i-star-filled" viewBox="0 0 24 24"><path d="m12 3.2 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.6l6-.9z" fill="currentColor"/></symbol>
      <symbol id="i-stethoscope" viewBox="0 0 24 24"><path d="M6 3.5v4.5a4 4 0 0 0 8 0V3.5"/><path d="M10 12v3a5 5 0 0 0 10 0v-2.5"/><circle cx="20" cy="10.5" r="2"/><path d="M5 3.5h2M13 3.5h2"/></symbol>
      <symbol id="i-zap" viewBox="0 0 24 24"><path d="M13 2.8 4.8 13.4H12L11 21.2l8.2-10.6H12z"/></symbol>
      <symbol id="i-pill" viewBox="0 0 24 24"><path d="m10.5 20.5 10-10a4.95 4.95 0 0 0-7-7l-10 10a4.95 4.95 0 0 0 7 7Z"/><path d="m8.5 8.5 7 7"/></symbol>
      <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.2 12s3.6-6.6 9.8-6.6 9.8 6.6 9.8 6.6-3.6 6.6-9.8 6.6S2.2 12 2.2 12Z"/><circle cx="12" cy="12" r="3"/></symbol>
      <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M17.9 17.9A10.6 10.6 0 0 1 12 18.6c-6.2 0-9.8-6.6-9.8-6.6a19.7 19.7 0 0 1 5.1-5.2M9.9 5.6A9.4 9.4 0 0 1 12 5.4c6.2 0 9.8 6.6 9.8 6.6a19.4 19.4 0 0 1-2.7 3.6M14.1 14.1a3 3 0 0 1-4.2-4.2"/><path d="M3 3l18 18"/></symbol>
      <symbol id="i-tablet" viewBox="0 0 24 24"><rect x="4.5" y="2.8" width="15" height="18.4" rx="2.2"/><path d="M12 17.8h.01"/></symbol>
      <symbol id="i-monitor" viewBox="0 0 24 24"><rect x="2.6" y="3.6" width="18.8" height="12.6" rx="2"/><path d="M8.5 20.4h7M12 16.2v4.2"/></symbol>
      <symbol id="i-trophy" viewBox="0 0 24 24"><path d="M7.5 4h9v5.2a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.6v1.4a3 3 0 0 0 3 3M16.5 6h2.9v1.4a3 3 0 0 1-3 3"/><path d="M12 13.7V17M8.6 20.4h6.8M9.6 20.4l.6-3.4h3.6l.6 3.4"/></symbol>
      <symbol id="i-heart" viewBox="0 0 24 24"><path d="M12 20.2s-7.6-4.6-8.9-9.4C2.3 7.6 4.3 4.6 7.4 4.6c2 0 3.4 1.1 4.6 2.8 1.2-1.7 2.6-2.8 4.6-2.8 3.1 0 5.1 3 4.3 6.2-1.3 4.8-8.9 9.4-8.9 9.4z"/></symbol>
      <symbol id="i-graduation" viewBox="0 0 24 24"><path d="M2.6 9.2L12 4.6l9.4 4.6L12 13.8z"/><path d="M6.4 11.1v4.6c1.6 1.5 3.4 2.2 5.6 2.2s4-.7 5.6-2.2v-4.6M21.4 9.2v5.4"/></symbol>
      <symbol id="i-notebook" viewBox="0 0 24 24"><rect x="5" y="3" width="14.4" height="18" rx="2"/><path d="M9 3v18M3.6 7.5H6.4M3.6 12H6.4M3.6 16.5H6.4M12 8h4.4M12 11.6h4.4"/></symbol>
      <symbol id="i-wallet" viewBox="0 0 24 24"><path d="M4 7.4h14.6a1.8 1.8 0 0 1 1.8 1.8v9a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.2z"/><path d="M4 7.4V6.2a2 2 0 0 1 2.4-2l9.6 1.6v1.6"/><path d="M20.4 11.6h-3.6a1.9 1.9 0 0 0 0 3.8h3.6"/></symbol>
      <symbol id="i-inbox" viewBox="0 0 24 24"><path d="M3.6 13.2l2.6-7.4a1.8 1.8 0 0 1 1.7-1.2h8.2a1.8 1.8 0 0 1 1.7 1.2l2.6 7.4v5a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8z"/><path d="M3.6 13.2h4.6l1.4 2.4h4.8l1.4-2.4h4.6"/></symbol>
      <symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 7h9.4M17.6 7H20M4 17h3.4M11.6 17H20"/><circle cx="15.5" cy="7" r="2.1"/><circle cx="9.5" cy="17" r="2.1"/></symbol>
      <symbol id="i-lifebuoy" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="3.6"/><path d="M5.9 5.9l3.6 3.6M14.5 14.5l3.6 3.6M18.1 5.9l-3.6 3.6M9.5 14.5l-3.6 3.6"/></symbol>
      <symbol id="i-flag" viewBox="0 0 24 24"><path d="M5.4 21V4.2"/><path d="M5.4 4.6c2.2-1.2 4.4-1.2 6.6 0s4.4 1.2 6.6 0v8.6c-2.2 1.2-4.4 1.2-6.6 0s-4.4-1.2-6.6 0"/></symbol>
      <symbol id="i-pencil-ruler" viewBox="0 0 24 24"><path d="M14.6 4.6l4.8 4.8L9.2 19.6H4.4v-4.8z"/><path d="M12.4 6.8l4.8 4.8"/></symbol>
      <symbol id="i-mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></symbol>
      <symbol id="i-mic-off" viewBox="0 0 24 24"><path d="M15 9.5V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.6 2.5"/><path d="M18.5 11a6.5 6.5 0 0 1-1 3.4M5.5 11a6.5 6.5 0 0 0 10 5.4M12 17.5V21M8.5 21h7M3.5 3.5l17 17"/></symbol>
      <symbol id="i-waveform" viewBox="0 0 24 24"><path d="M4 10v4M8 6.5v11M12 3.5v17M16 7.5v9M20 10.5v3"/></symbol>
    </svg>
  );
}
