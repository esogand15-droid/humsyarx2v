import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import './account.css';
import { AppBar, Brand, DeviceListModal } from '../components';
import { DsBadge, DsButton, DsCard, DsSegmented } from '../design/components';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import { faDigits } from '../lib/fa';
import { groupLabel, intakeLabel } from '../lib/intake';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';

type InfoSheetKind = 'security' | 'faq' | 'about' | null;

function AccountSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="acct-sheet-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="acct-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="acct-sheet__head">
          <h2 className="acct-sheet__title">{title}</h2>
          <button type="button" className="acct-sheet__close" aria-label="بستن" onClick={onClose}>
            <Icon name="i-x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MeNavRow({
  icon,
  title,
  sub,
  to,
  onClick,
  danger,
}: {
  icon: IconName;
  title: string;
  sub?: string;
  to?: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  const content = (
    <>
      <span className="ds-row__icon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <span className="ds-row__body">
        <span className="ds-row__title">{title}</span>
        {sub && <span className="ds-row__sub">{sub}</span>}
      </span>
      {(to || onClick) && !danger && (
        <Icon name="i-chevron-r" size={18} className="ds-row__chev" />
      )}
    </>
  );

  const cls = `ds-row${danger ? ' acct-row-danger' : ''}`;
  if (to) {
    return (
      <Link className={cls} to={to}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick}>
      {content}
    </button>
  );
}

/** «هامزیار من» — هویت دانشجویی، تنظیمات ظاهر، امنیت و دسترسی به ابزارهای حساب. */
export function MeScreen() {
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const { user, signOut } = useSession();
  const [leaving, setLeaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [activeSheet, setActiveSheet] = useState<InfoSheetKind>(null);

  const name = user?.name?.trim() || 'دانشجوی هامزیار';
  const rawStudentId = user?.student_id?.trim() || '';
  const studentIdFa = rawStudentId ? faDigits(rawStudentId) : '';
  const webLoginCode =
    (user as (typeof user & { web_login_code?: string }) | null)?.web_login_code?.trim() || '';
  const copyTarget = webLoginCode || rawStudentId;
  const group = groupLabel(user?.group);
  const intake = intakeLabel(user?.intake);

  const copyCode = () => {
    if (!copyTarget) return;
    void navigator.clipboard.writeText(copyTarget).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <AppBar title="هامزیار من" sub="حساب، دستگاه‌ها و ظاهر" />
      <div className="page page-enter acct-page">
        <div className="acct-two-col">
          <aside className="acct-col-side">
            <DsCard className="acct-identity">
              <Brand size="xl" />
              <h2 className="acct-identity__name">{name}</h2>
              <p className="acct-identity__meta">
                {user?.username && <bdi dir="ltr">@{user.username}</bdi>}
                {user?.username && studentIdFa ? <span aria-hidden="true">·</span> : null}
                <span>
                  شمارهٔ دانشجویی:{' '}
                  {studentIdFa ? <bdi dir="ltr">{studentIdFa}</bdi> : 'ثبت‌نشده'}
                </span>
              </p>
              <div className="acct-identity__badges">
                <DsBadge tone="success">
                  <Icon name="i-check" size={12} />
                  <span>حساب تأییدشده</span>
                </DsBadge>
                {group && <DsBadge tone="accent">{group}</DsBadge>}
                {intake && <DsBadge tone="neutral">{intake}</DsBadge>}
              </div>
            </DsCard>

            <DsCard className="acct-code-card">
              <div className="acct-code-card__head">
                <div className="acct-card-stack">
                  <h3 className="ds-card__title">کد ورود اختصاصی (۸ کاراکتری)</h3>
                  <p className="ds-card__sub">
                    {webLoginCode
                      ? 'برای ورود در صفحهٔ ورود وب‌اپ استفاده می‌شود؛ آن را محرمانه نگه دارید.'
                      : 'کد ۸ کاراکتری ورود از طریق ربات تلگرام صادر می‌شود و در صفحهٔ ورود وب‌اپ کاربرد دارد.'}
                  </p>
                </div>
                {copyTarget && (
                  <DsButton
                    variant="secondary"
                    size="md"
                    onClick={copyCode}
                    className="acct-code-card__copy"
                  >
                    <Icon name={copied ? 'i-check' : 'i-copy'} size={16} />
                    <span>
                      {copied ? (
                        'کپی شد'
                      ) : webLoginCode ? (
                        <bdi dir="ltr">{webLoginCode}</bdi>
                      ) : (
                        `شماره: ${studentIdFa}`
                      )}
                    </span>
                  </DsButton>
                )}
              </div>
            </DsCard>

            <DsCard className="acct-card-stack">
              <div>
                <h3 className="ds-card__title">ظاهر و تم سامانه</h3>
                <p className="ds-card__sub">انتخاب میان حالت روشن، تاریک یا همگام با سیستم</p>
              </div>
              <div className="acct-me-seg">
                <DsSegmented
                  block
                  label="انتخاب تم"
                  value={mode}
                  onChange={setMode}
                  options={[
                    {
                      value: 'light',
                      label: (
                        <span className="acct-seg-label">
                          <Icon name="i-sun" size={16} />
                          <span>روشن</span>
                        </span>
                      ),
                    },
                    {
                      value: 'dark',
                      label: (
                        <span className="acct-seg-label">
                          <Icon name="i-moon" size={16} />
                          <span>تاریک</span>
                        </span>
                      ),
                    },
                    {
                      value: 'system',
                      label: (
                        <span className="acct-seg-label">
                          <Icon name="i-smartphone" size={16} />
                          <span>خودکار</span>
                        </span>
                      ),
                    },
                  ]}
                />
              </div>
            </DsCard>
          </aside>

          <section className="acct-col-main" aria-label="مدیریت حساب و تنظیمات">
            <DsCard flush>
              <div className="ds-list">
                <MeNavRow
                  icon="i-award"
                  title="کارنامه تحصیلی"
                  sub="مشاهده نمرات و معدل وزنی"
                  to="/grades"
                />
                <MeNavRow
                  icon="i-pen"
                  title="دفتر من"
                  sub="یادداشت‌ها و خط‌کشیده‌های جزوه‌ها"
                  to="/me/notes"
                />
                <MeNavRow
                  icon="i-smartphone"
                  title="دستگاه‌های من"
                  sub="مدیریت نشست‌ها و دستگاه‌های متصل"
                  onClick={() => setShowDevices(true)}
                />
                <MeNavRow
                  icon="i-credit-card"
                  title="اشتراک"
                  sub="وضعیت فعلی و تمدید دسترسی"
                  to="/subscription"
                />
                <MeNavRow
                  icon="i-bell"
                  title="اعلان‌ها"
                  sub="پیام‌ها و اطلاعیه‌های سامانه"
                  to="/notifications"
                />
                <MeNavRow
                  icon="i-shield"
                  title="امنیت حساب"
                  sub="محافظت از کد ورود و بررسی نشست‌ها"
                  onClick={() => setActiveSheet('security')}
                />
              </div>
            </DsCard>

            <DsCard flush>
              <div className="ds-list">
                <MeNavRow
                  icon="i-message-circle"
                  title="پشتیبانی و تیکت‌ها"
                  sub="ارسال درخواست و گفتگو با تیم پشتیبانی"
                  to="/tickets"
                />
                <MeNavRow
                  icon="i-help-circle"
                  title="راهنما و سوالات متداول"
                  sub="نصب وب‌اپ، همگام‌سازی و استفاده از امکانات"
                  onClick={() => setActiveSheet('faq')}
                />
                <MeNavRow
                  icon="i-info"
                  title="دربارهٔ هامزیار"
                  sub="دستیار هوشمند دانشجویان علوم پزشکی"
                  onClick={() => setActiveSheet('about')}
                />
              </div>
            </DsCard>

            <DsCard flush>
              <div className="ds-list">
                <MeNavRow
                  icon="i-log-out"
                  title={leaving ? 'در حال خروج…' : 'خروج از حساب'}
                  danger
                  onClick={() => {
                    if (leaving) return;
                    setLeaving(true);
                    void signOut().finally(() => setLeaving(false));
                  }}
                />
              </div>
            </DsCard>

            <p className="acct-version-foot">هامزیار · نسخهٔ ۲٫۰ · دستیار هوشمند دانشجویان پزشکی</p>
          </section>
        </div>
      </div>

      <DeviceListModal open={showDevices} onClose={() => setShowDevices(false)} />

      <AccountSheet
        open={activeSheet === 'security'}
        onClose={() => setActiveSheet(null)}
        title="امنیت حساب کاربری"
      >
        <ul className="acct-sheet__list">
          <li className="acct-sheet__item">
            <span className="acct-sheet__item-title">کد ورود اختصاصی (۸ کاراکتری)</span>
            <p className="acct-sheet__item-body">
              ورود به وب‌اپ با کد ۸ کاراکتری و تأیید آنی در ربات تلگرام انجام می‌شود. این کد را در
              اختیار افراد دیگر قرار ندهید.
            </p>
          </li>
          <li className="acct-sheet__item">
            <span className="acct-sheet__item-title">مدیریت دستگاه‌های فعال</span>
            <p className="acct-sheet__item-body">
              در بخش «دستگاه‌های من» می‌توانید نشست‌های قدیمی یا ناشناس را با یک لمس لغو کنید.
            </p>
          </li>
        </ul>
        <DsButton
          variant="primary"
          size="md"
          block
          onClick={() => {
            setActiveSheet(null);
            setShowDevices(true);
          }}
        >
          مشاهدهٔ دستگاه‌های متصل
        </DsButton>
      </AccountSheet>

      <AccountSheet
        open={activeSheet === 'faq'}
        onClose={() => setActiveSheet(null)}
        title="راهنما و سوالات متداول"
      >
        <ul className="acct-sheet__list">
          <li className="acct-sheet__item">
            <span className="acct-sheet__item-title">چطور یادداشت‌های جزوه همگام می‌شوند؟</span>
            <p className="acct-sheet__item-body">
              همهٔ خط‌کشیده‌ها و حاشیه‌نویسی‌های شما داخل کتابخوان به‌صورت خودکار ذخیره و در بخش
              «دفتر من» روی تمام دستگاه‌ها همگام می‌شوند.
            </p>
          </li>
          <li className="acct-sheet__item">
            <span className="acct-sheet__item-title">آزمون زمان‌دار چطور کار می‌کند؟</span>
            <p className="acct-sheet__item-body">
              مهلت آزمون از سرور کنترل می‌شود و در میانهٔ آزمون پاسخ درست نمایش داده نمی‌شود تا
              شبیه‌سازی واقعی امتحان حفظ شود.
            </p>
          </li>
        </ul>
        <DsButton
          variant="secondary"
          size="md"
          block
          onClick={() => {
            setActiveSheet(null);
            navigate('/install');
          }}
        >
          مشاهدهٔ راهنمای نصب وب‌اپ
        </DsButton>
      </AccountSheet>

      <AccountSheet
        open={activeSheet === 'about'}
        onClose={() => setActiveSheet(null)}
        title="دربارهٔ هامزیار"
      >
        <ul className="acct-sheet__list">
          <li className="acct-sheet__item">
            <span className="acct-sheet__item-title">پلتفرم یکپارچهٔ دانشجویان پزشکی</span>
            <p className="acct-sheet__item-body">
              هامزیار نسخهٔ ۲٫۰ دسترسی سریع به جزوه‌ها، بانک سؤال بالینی، آزمون‌های زمان‌دار، برنامهٔ
              مطالعه و دستیار هوشمند را در یک فضای یکدست فراهم می‌کند.
            </p>
          </li>
        </ul>
        <DsButton
          variant="secondary"
          size="md"
          block
          onClick={() => {
            setActiveSheet(null);
            navigate('/tickets');
          }}
        >
          ارتباط با پشتیبانی
        </DsButton>
      </AccountSheet>
    </>
  );
}
