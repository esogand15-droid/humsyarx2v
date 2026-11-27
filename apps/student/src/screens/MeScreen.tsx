import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import './account.css';
import { AppBar, Brand, Sheet } from '../components';
import { DeviceListPanel } from '../components/DeviceListModal';
import { DsBadge, DsButton, DsCard, DsSegmented } from '../design/components';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import { faDigits } from '../lib/fa';
import { groupLabel, intakeLabel } from '../lib/intake';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';

type AccountSheetKind = 'security' | 'devices' | 'faq' | 'about' | null;

const SHEET_TITLE: Record<Exclude<AccountSheetKind, null>, string> = {
  security: 'امنیت حساب کاربری',
  devices: 'دستگاه‌های متصل',
  faq: 'راهنما و سوالات متداول',
  about: 'دربارهٔ هامزیار',
};

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

/** «هامزیار من» — هویت دانشجویی، کد ۸ کاراکتری مخفی‌پذیر، تنظیمات ظاهر و شیت یکپارچه حساب/دستگاه‌ها. */
export function MeScreen() {
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const { user, signOut, refresh } = useSession();
  const [leaving, setLeaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [codeVisible, setCodeVisible] = useState(false);
  const [refreshingCode, setRefreshingCode] = useState(false);
  const [activeSheet, setActiveSheet] = useState<AccountSheetKind>(null);
  const [devicesFromSecurity, setDevicesFromSecurity] = useState(false);

  const name = user?.name?.trim() || 'دانشجوی هامزیار';
  const rawStudentId = user?.student_id?.trim() || '';
  const studentIdFa = rawStudentId ? faDigits(rawStudentId) : '';
  const webLoginCode = user?.web_login_code?.trim() || '';
  const group = groupLabel(user?.group);
  const intake = intakeLabel(user?.intake);

  const copyCode = () => {
    if (!webLoginCode) return;
    navigator.clipboard?.writeText(webLoginCode)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  const handleRefreshCode = () => {
    if (refreshingCode) return;
    setRefreshingCode(true);
    void refresh().finally(() => setRefreshingCode(false));
  };

  const openSheet = (kind: Exclude<AccountSheetKind, null>, fromSecurity = false) => {
    setDevicesFromSecurity(fromSecurity);
    setActiveSheet(kind);
  };

  const closeSheet = () => {
    setActiveSheet(null);
    setDevicesFromSecurity(false);
  };

  const maskedCode = '••••••••';

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
                      : 'کد اختصاصی ورود هنوز دریافت نشد. از دکمهٔ تازه‌سازی استفاده کنید یا کد خود را در ربات تلگرام ببینید.'}
                  </p>
                </div>
              </div>

              {webLoginCode ? (
                <div className="acct-code-row">
                  <div className="acct-code-box" aria-live="polite">
                    <bdi dir="ltr" className="acct-code-box__val">
                      {codeVisible ? webLoginCode : maskedCode}
                    </bdi>
                    <button
                      type="button"
                      className="acct-code-box__eye"
                      onClick={() => setCodeVisible((v) => !v)}
                      aria-label={codeVisible ? 'پنهان کردن کد ورود' : 'نمایش کد ورود'}
                      title={codeVisible ? 'پنهان کردن کد' : 'نمایش کد'}
                    >
                      <Icon name={codeVisible ? 'i-eye-off' : 'i-eye'} size={18} />
                    </button>
                  </div>

                  <DsButton
                    variant="secondary"
                    size="md"
                    onClick={copyCode}
                    className="acct-code-card__copy"
                  >
                    <Icon name={copied ? 'i-check' : 'i-copy'} size={16} />
                    <span>{copied ? 'کپی شد' : 'کپی'}</span>
                  </DsButton>
                </div>
              ) : (
                <div className="acct-code-fallback">
                  <DsButton
                    variant="secondary"
                    size="md"
                    disabled={refreshingCode}
                    onClick={handleRefreshCode}
                  >
                    <Icon name="i-refresh" size={16} />
                    <span>{refreshingCode ? 'در حال دریافت…' : 'تازه‌سازی کد'}</span>
                  </DsButton>
                </div>
              )}
            </DsCard>

            <DsCard className="acct-card-stack">
              <div>
                <h3 className="ds-card__title">ظاهر و تم سامانه</h3>
                <p className="ds-card__sub">انتخاب میان حالت روشن، تاریک یا پیش‌فرض سیستم</p>
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
                  onClick={() => openSheet('devices', false)}
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
                  onClick={() => openSheet('security', false)}
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
                  sub="نصب وب‌اپ، راهنما و استفاده از امکانات"
                  onClick={() => openSheet('faq', false)}
                />
                <MeNavRow
                  icon="i-info"
                  title="دربارهٔ هامزیار"
                  sub="دستیار هوشمند دانشجویان علوم پزشکی"
                  onClick={() => openSheet('about', false)}
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
          </section>
        </div>

        <footer className="acct-credit">
          <p className="acct-credit__made">
            <span>ساخته شده توسط</span>
            <bdi dir="ltr" className="acct-credit__name">pwker</bdi>
            <span>با</span>
            <span className="acct-credit__heart" role="img" aria-label="عشق">
              ❤️
            </span>
          </p>
        </footer>
      </div>

      <Sheet
        open={activeSheet !== null}
        onClose={closeSheet}
        title={activeSheet ? SHEET_TITLE[activeSheet] : ''}
        size="compact"
        onBack={
          activeSheet === 'devices' && devicesFromSecurity
            ? () => openSheet('security', false)
            : undefined
        }
        backLabel="بازگشت به امنیت حساب"
      >
        {activeSheet === 'security' && (
          <div key="security" className="acct-sheet-body mo-sheet-swap">
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
              onClick={() => openSheet('devices', true)}
            >
              مشاهدهٔ دستگاه‌های متصل
            </DsButton>
          </div>
        )}

        {activeSheet === 'devices' && (
          <div key="devices" className="acct-sheet-body mo-sheet-swap">
            <DeviceListPanel active={activeSheet === 'devices'} />
          </div>
        )}

        {activeSheet === 'faq' && (
          <div key="faq" className="acct-sheet-body mo-sheet-swap">
            <ul className="acct-sheet__list">
              <li className="acct-sheet__item">
                <span className="acct-sheet__item-title">یادداشت‌های جزوه کجا ذخیره می‌شوند؟</span>
                <p className="acct-sheet__item-body">
                  همهٔ خط‌کشیده‌ها و حاشیه‌نویسی‌های شما داخل کتابخوان به‌صورت خودکار ذخیره و در
                  بخش «دفتر من» نگهداری می‌شوند.
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
                closeSheet();
                navigate('/install');
              }}
            >
              مشاهدهٔ راهنمای نصب وب‌اپ
            </DsButton>
          </div>
        )}

        {activeSheet === 'about' && (
          <div key="about" className="acct-sheet-body mo-sheet-swap">
            <ul className="acct-sheet__list">
              <li className="acct-sheet__item">
                <span className="acct-sheet__item-title">هامزیار · نسخهٔ ۲٫۰</span>
                <p className="acct-sheet__item-body">
                  پلتفرم یکپارچهٔ دانشجویان علوم پزشکی برای دسترسی سریع به جزوه‌ها، بانک سؤال بالینی،
                  آزمون‌های زمان‌دار، برنامهٔ مطالعه و دستیار هوشمند در یک فضای یکدست.
                </p>
              </li>
            </ul>
            <DsButton
              variant="secondary"
              size="md"
              block
              onClick={() => {
                closeSheet();
                navigate('/tickets');
              }}
            >
              ارتباط با پشتیبانی
            </DsButton>
          </div>
        )}
      </Sheet>
    </>
  );
}
