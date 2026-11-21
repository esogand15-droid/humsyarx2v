import { useState } from 'react';
import { Link } from 'react-router-dom';

import { AppBar, Brand, Card, Chip, DeviceListModal, ListRow } from '../components';
import { Icon } from '../icons';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';

/** «من» — حساب کاربری، تنظیمات و خروج */
export function MeScreen() {
  const { mode, setMode } = useTheme();
  const { user, signOut } = useSession();
  const [leaving, setLeaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDevices, setShowDevices] = useState(false);

  const name = user?.name?.trim() || 'دانشجوی هامزیار';
  const code = user?.student_id?.trim() || '—';
  const handle = user?.username ? `@${user.username}` : '—';
  const group = user?.group || '';
  const intake = user?.intake || '';

  const copyCode = () => {
    if (code && code !== '—') {
      void navigator.clipboard.writeText(code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <>
      <AppBar title="هامزیار من" sub="حساب، دستگاه‌ها و ظاهر" />
      <div className="page">
        {/* هویت */}
        <Card className="mt-8 card--glass" style={{ textAlign: 'center', padding: '24px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Brand size="xl" />
          </div>
          <div className="h2 mt-12">{name}</div>
          <p className="small mt-8 color-muted">
            {handle} · شمارهٔ دانشجویی <span className="tabular-nums" style={{ direction: 'ltr', display: 'inline-block' }}>{code}</span>
          </p>
          <div className="row gap-8 mt-12" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <Chip variant="cyan" icon="i-check">حساب دانشجویی تأییدشده</Chip>
            {group ? <Chip variant="brand">{group}</Chip> : null}
            {intake ? <Chip variant="quiet">{intake}</Chip> : null}
          </div>
        </Card>

        {/* کد کاربری */}
        <Card className="mt-12 card--glass">
          <div className="row row--between">
            <div>
              <div className="h3">کد کاربری اختصاصی</div>
              <div className="small mt-4 color-muted">برای ورود سریع به وب‌اپ و اشتراک‌گذاری</div>
            </div>
            <button
              className="btn btn--sm btn--ghost"
              onClick={copyCode}
              style={{ direction: 'ltr', borderColor: 'var(--line-2)' }}
            >
              <Icon name={copied ? 'i-check' : 'i-copy'} size={16} />
              {copied ? 'کپی شد' : code}
            </button>
          </div>
        </Card>

        {/* ظاهر و تم سامانه */}
        <Card className="mt-12 card--glass" style={{ padding: '16px 20px' }}>
          <div className="h3">ظاهر و تم سامانه</div>
          <div className="small color-muted mt-4">انتخاب میان حالت تاریک نایت یا سفید کلینیکال</div>
          <div className="seg mt-12" role="tablist" aria-label="انتخاب تم">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'light'}
              className={`seg__btn ${mode === 'light' ? 'is-on' : ''}`.trim()}
              onClick={() => setMode('light')}
            >
              ☀️ روشن
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'dark'}
              className={`seg__btn ${mode === 'dark' ? 'is-on' : ''}`.trim()}
              onClick={() => setMode('dark')}
            >
              🌙 تاریک
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'system'}
              className={`seg__btn ${mode === 'system' ? 'is-on' : ''}`.trim()}
              onClick={() => setMode('system')}
            >
              💻 خودکار
            </button>
          </div>
        </Card>

        {/* دسترسی‌ها */}
        <Card variant="flush" className="mt-12">
          <Link to="/grades">
            <ListRow icon="i-award" title="کارنامه تحصیلی" sub="مشاهده نمرات و معدل وزنی (GPA)" chevron />
          </Link>
          <Link to="/me/notes">
            <ListRow icon="i-pen" title="دفتر من" sub="یادداشت‌ها و خط‌کشیده‌ها" chevron />
          </Link>
          <ListRow
            icon="i-smartphone"
            title="دستگاه‌های من"
            sub="مدیریت دستگاه‌های متصل"
            chevron
            onClick={() => setShowDevices(true)}
          />
          <Link to="/subscription">
            <ListRow icon="i-credit-card" title="اشتراک" sub="وضعیت و تمدید اشتراک" chevron />
          </Link>
          <Link to="/notifications">
            <ListRow icon="i-bell" title="اعلان‌ها" sub="پیام‌ها و اطلاعیه‌های سامانه" chevron />
          </Link>
          <ListRow icon="i-shield" title="امنیت" sub="تغییر کد کاربری و خروج از همه دستگاه‌ها" chevron onClick={() => {}} />
        </Card>

        {/* پشتیبانی */}
        <Card variant="flush" className="mt-12">
          <Link to="/tickets">
            <ListRow icon="i-message-circle" title="پشتیبانی" sub="ارسال تیکت و ارتباط با تیم هامزیار" chevron />
          </Link>
          <ListRow icon="i-help-circle" title="راهنما و سوالات متداول" sub="آموزش استفاده از اپ" chevron onClick={() => {}} />
          <ListRow icon="i-info" title="دربارهٔ هامزیار" sub="نسخه ۲.۰ · ساخته‌شده با ❤️" chevron onClick={() => {}} />
        </Card>

        {/* خروج */}
        <Card variant="flush" className="mt-12">
          <ListRow
            icon="i-log-out"
            title={leaving ? 'در حال خروج…' : 'خروج از حساب'}
            danger
            onClick={() => {
              if (leaving) return;
              setLeaving(true);
              void signOut().finally(() => setLeaving(false));
            }}
          />
        </Card>

        <p className="tiny mt-16" style={{ textAlign: 'center' }}>
          هامزیار v2.0 · دستیار هوشمند دانشجویان پزشکی
        </p>
      </div>

      <DeviceListModal open={showDevices} onClose={() => setShowDevices(false)} />
    </>
  );
}
