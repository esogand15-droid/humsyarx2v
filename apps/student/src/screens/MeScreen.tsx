import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import './account.css';
import { AppBar, Brand, Sheet, Switch, Toast } from '../components';
import { DeviceListPanel } from '../components/DeviceListModal';
import { DsBadge, DsButton, DsCard, DsChip, DsSegmented } from '../design/components';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import { errorText } from '../lib/api';
import { faDigits, faNum } from '../lib/fa';
import { groupLabel, intakeLabel } from '../lib/intake';
import { loadAccount, peekAccount, type AccountData } from '../lib/accountData';
import {
  profileApi,
  type FaqItem,
  type IntakeItem,
  type PrestigeState,
  type ProfileUser,
  type ReferralMine,
} from '../lib/profile';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';

type AccountSheetKind = 'profile' | 'security' | 'devices' | 'faq' | 'about' | null;

const SHEET_TITLE: Record<Exclude<AccountSheetKind, null>, string> = {
  profile: 'ویرایش پروفایل و اطلاعات تحصیلی',
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

/** «هامزیار من» — پروفایل قابل‌ویرایش، کد ورود وب‌اپ، نشان‌ها/رقابت، دعوت از دوستان و راهنمای زنده. */
export function MeScreen() {
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const { user, signOut, refresh } = useSession();

  // The cached account paints the final first frame; the fetch below only refreshes it.
  const [cached] = useState(() => peekAccount());
  const [profileUser, setProfileUser] = useState<ProfileUser | null>(cached?.profile ?? null);
  const [prestige, setPrestige] = useState<PrestigeState | null>(cached?.prestige ?? null);
  const [referral, setReferral] = useState<ReferralMine | null>(cached?.referral ?? null);
  const [donation, setDonation] = useState<{ enabled: boolean; link: string } | null>(cached?.donation ?? null);
  const [intakes, setIntakes] = useState<IntakeItem[]>(cached?.intakes ?? []);
  const [accountReady, setAccountReady] = useState(Boolean(cached?.profile));

  const [leaving, setLeaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);
  const [codeVisible, setCodeVisible] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [localCodeOverride, setLocalCodeOverride] = useState('');
  const [activeSheet, setActiveSheet] = useState<AccountSheetKind>(null);
  const [devicesFromSecurity, setDevicesFromSecurity] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // فیلدهای فرم ویرایش پروفایل
  const [nameInput, setNameInput] = useState(cached?.profile?.name || '');
  const [nicknameInput, setNicknameInput] = useState(cached?.profile?.nickname || '');
  const [studentIdInput, setStudentIdInput] = useState(cached?.profile?.student_id || '');
  const [selectedIntake, setSelectedIntake] = useState(cached?.profile?.intake || '');
  const [savingField, setSavingField] = useState<string | null>(null);

  // FAQ زنده
  const [faqCategories, setFaqCategories] = useState<Array<{ name: string; items: FaqItem[] }>>([]);
  const [faqQuery, setFaqQuery] = useState('');
  const [faqSearchResults, setFaqSearchResults] = useState<FaqItem[] | null>(null);
  const [faqOpenId, setFaqOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const applyAccount = useCallback((a: AccountData) => {
    const u = a.profile;
    if (u) {
      setProfileUser(u);
      setNameInput(u.name || '');
      setNicknameInput(u.nickname || '');
      setStudentIdInput(u.student_id || '');
      setSelectedIntake(u.intake || '');
    }
    setPrestige(a.prestige);
    setReferral(a.referral);
    setDonation(a.donation);
    setIntakes(a.intakes);
  }, []);

  const loadExtendedProfile = useCallback(async () => {
    try {
      applyAccount(await loadAccount());
    } finally {
      setAccountReady(true);
    }
  }, [applyAccount]);

  useEffect(() => {
    void loadExtendedProfile();
  }, [loadExtendedProfile]);

  useEffect(() => {
    if (activeSheet !== 'faq' || faqCategories.length > 0) return;
    profileApi
      .faq()
      .then((res) => setFaqCategories(res.categories || []))
      .catch(() => undefined);
  }, [activeSheet, faqCategories.length]);

  useEffect(() => {
    const q = faqQuery.trim();
    if (q.length < 2) {
      setFaqSearchResults(null);
      return undefined;
    }
    const t = window.setTimeout(() => {
      profileApi
        .faqSearch(q)
        .then((res) => setFaqSearchResults(res.results || []))
        .catch(() => setFaqSearchResults([]));
    }, 260);
    return () => window.clearTimeout(t);
  }, [faqQuery]);

  const displayName = profileUser?.display_name?.trim() || user?.name?.trim() || 'دانشجوی هامزیار';
  const realName = profileUser?.name?.trim() || user?.name?.trim() || '';
  const rawStudentId = profileUser?.student_id?.trim() || user?.student_id?.trim() || '';
  const studentIdFa = rawStudentId ? faDigits(rawStudentId) : '';
  const webLoginCode = localCodeOverride || profileUser?.web_login_code?.trim() || user?.web_login_code?.trim() || '';
  const group = groupLabel(profileUser?.group || user?.group);
  // One label from first paint on: derived from the intake code (session or profile),
  // the server label only for codes the client cannot read.
  const intake = intakeLabel(profileUser?.intake || user?.intake) || profileUser?.intake_label || '';
  const eduGroupLabel =
    profileUser?.educational_group === 'male'
      ? 'برادران'
      : profileUser?.educational_group === 'female'
        ? 'خواهران'
        : '';

  const copyCode = () => {
    if (!webLoginCode) return;
    navigator.clipboard
      ?.writeText(webLoginCode)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  const handleRegenCode = async () => {
    if (regenBusy) return;
    setRegenBusy(true);
    try {
      const res = await profileApi.regenerateWebCode();
      if (res.web_login_code) {
        setLocalCodeOverride(res.web_login_code);
        setCodeVisible(true);
      }
      await Promise.all([refresh(), loadExtendedProfile()]);
      setToast('کد ورود جدید تولید شد.');
    } catch (e) {
      setToast(errorText(e, 'بازتولید کد ورود ناموفق بود.'));
    } finally {
      setRegenBusy(false);
    }
  };

  const saveName = async () => {
    if (!nameInput.trim() || savingField) return;
    setSavingField('name');
    try {
      await profileApi.updateName(nameInput.trim());
      await Promise.all([refresh(), loadExtendedProfile()]);
      setToast('نام نمایشی ذخیره شد.');
    } catch (e) {
      setToast(errorText(e, 'ذخیره نام ناموفق بود.'));
    } finally {
      setSavingField(null);
    }
  };

  const saveNickname = async () => {
    if (savingField) return;
    setSavingField('nickname');
    try {
      await profileApi.updateNickname(nicknameInput.trim());
      await loadExtendedProfile();
      setToast(nicknameInput.trim() ? 'لقب ذخیره شد.' : 'لقب حذف شد.');
    } catch (e) {
      setToast(errorText(e, 'ذخیره لقب ناموفق بود.'));
    } finally {
      setSavingField(null);
    }
  };

  const savePrivacy = async (showReal: boolean) => {
    try {
      await profileApi.updatePrivacy(showReal);
      setProfileUser((prev) => (prev ? { ...prev, show_real_name: showReal } : prev));
      setToast('تنظیم نمایش نام بروزرسانی شد.');
    } catch (e) {
      setToast(errorText(e, 'تغییر وضعیت نمایش نام ناموفق بود.'));
    }
  };

  const saveGroup = async (g: '1' | '2') => {
    setSavingField('group');
    try {
      await profileApi.updateGroup(g);
      await Promise.all([refresh(), loadExtendedProfile()]);
      setToast(`گروه ${faNum(g)} ثبت شد.`);
    } catch (e) {
      setToast(errorText(e, 'تغییر گروه ناموفق بود.'));
    } finally {
      setSavingField(null);
    }
  };

  const saveEduGroup = async (eg: 'male' | 'female') => {
    setSavingField('edu');
    try {
      await profileApi.updateEducationalGroup(eg);
      await loadExtendedProfile();
      setToast('گروه آموزشی ذخیره شد.');
    } catch (e) {
      setToast(errorText(e, 'ثبت گروه آموزشی ناموفق بود.'));
    } finally {
      setSavingField(null);
    }
  };

  const saveIntake = async (code: string) => {
    setSelectedIntake(code);
    setSavingField('intake');
    try {
      await profileApi.updateIntake(code);
      await Promise.all([refresh(), loadExtendedProfile()]);
      setToast('ورودی تحصیلی ذخیره شد.');
    } catch (e) {
      setToast(errorText(e, 'تغییر ورودی ناموفق بود.'));
    } finally {
      setSavingField(null);
    }
  };

  const saveStudentId = async () => {
    if (!studentIdInput.trim() || savingField) return;
    setSavingField('sid');
    try {
      await profileApi.updateStudentId(studentIdInput.trim());
      await Promise.all([refresh(), loadExtendedProfile()]);
      setToast('شماره دانشجویی ذخیره شد.');
    } catch (e) {
      setToast(errorText(e, 'ذخیره شماره دانشجویی ناموفق بود.'));
    } finally {
      setSavingField(null);
    }
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
      <AppBar
        title="هامزیار من"
        sub="هویت دانشجویی، پرستیژ، دستگاه‌ها و تنظیمات"
        actions={
          <DsButton variant="ghost" size="sm" onClick={() => openSheet('profile', false)}>
            <Icon name="i-pen" size={16} />
            <span>ویرایش</span>
          </DsButton>
        }
      />
      <div className="page page-enter acct-page">
        <div className="acct-two-col">
          <aside className="acct-col-side">
            <DsCard className="acct-identity">
              <Brand size="xl" />
              <h2 className="acct-identity__name">{displayName}</h2>
              {profileUser?.nickname && realName && (
                <p className="acct-identity__meta" style={{ marginTop: 0 }}>
                  نام واقعی: {realName}
                </p>
              )}
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
                {eduGroupLabel && <DsBadge tone="neutral">{eduGroupLabel}</DsBadge>}
                {!accountReady && <span className="skeleton skeleton--shimmer acct-badge-skel" aria-hidden="true" />}
                {prestige?.tier_name && (
                  <DsBadge tone="warning">
                    {prestige.tier_icon || '🏅'} {prestige.tier_name}
                  </DsBadge>
                )}
              </div>
              <div style={{ marginTop: 10 }}>
                <DsButton variant="secondary" size="sm" onClick={() => openSheet('profile', false)}>
                  <Icon name="i-pen" size={14} />
                  <span>ویرایش اطلاعات تحصیلی و لقب</span>
                </DsButton>
              </div>
            </DsCard>

            <DsCard className="acct-code-card">
              <div className="acct-code-card__head">
                <div className="acct-card-stack">
                  <h3 className="ds-card__title">کد ورود اختصاصی (۸ کاراکتری)</h3>
                  <p className="ds-card__sub">
                    {webLoginCode
                      ? 'برای ورود به وب‌اپ روی دستگاه‌های دیگر استفاده می‌شود؛ در صورت نیاز می‌توانید آن را مستقیم تغییر دهید.'
                      : 'کد اختصاصی ورود هنوز دریافت نشد. دکمهٔ تولید کد را بزنید.'}
                  </p>
                </div>
              </div>

              {webLoginCode ? (
                <div className="acct-code-row" style={{ flexWrap: 'wrap' }}>
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

                  <DsButton
                    variant="ghost"
                    size="md"
                    disabled={regenBusy}
                    onClick={() => void handleRegenCode()}
                  >
                    <Icon name="i-refresh" size={16} />
                    <span>{regenBusy ? 'در حال تغییر…' : 'بازتولید کد'}</span>
                  </DsButton>
                </div>
              ) : (
                <div className="acct-code-fallback">
                  <DsButton
                    variant="secondary"
                    size="md"
                    disabled={regenBusy}
                    onClick={() => void handleRegenCode()}
                  >
                    <Icon name="i-refresh" size={16} />
                    <span>{regenBusy ? 'در حال دریافت…' : 'تولید کد ورود'}</span>
                  </DsButton>
                </div>
              )}
            </DsCard>

            {referral?.enabled && (
              <DsCard className="acct-card-stack">
                <div>
                  <h3 className="ds-card__title">دعوت از هم‌دانشگاهی‌ها</h3>
                  <p className="ds-card__sub">
                    کد معرف شما: <bdi dir="ltr">{referral.code}</bdi> · دعوت‌شده:{' '}
                    {faNum(referral.stats?.invited ?? 0)} · فعال‌شده:{' '}
                    {faNum(referral.stats?.activated ?? 0)}
                  </p>
                </div>
                {referral.link && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <DsButton
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard
                          ?.writeText(referral.link || referral.code || '')
                          .then(() => {
                            setCopiedRef(true);
                            window.setTimeout(() => setCopiedRef(false), 2000);
                          })
                          .catch(() => undefined);
                      }}
                    >
                      <Icon name={copiedRef ? 'i-check' : 'i-copy'} size={15} />
                      <span>{copiedRef ? 'لینک دعوت کپی شد' : 'کپی لینک دعوت'}</span>
                    </DsButton>
                  </div>
                )}
              </DsCard>
            )}

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
            <h3 className="acct-group__title">پیشرفت من</h3>
            <DsCard flush>
              <div className="ds-list">
                <MeNavRow
                  icon="i-trophy"
                  title="رقابت و دستاوردها"
                  sub="نشانها، پرستیژ، جدول رقابت و تازهها"
                  to="/me/badges"
                />
                <MeNavRow
                  icon="i-graduation"
                  title="کارنامه تحصیلی"
                  sub="نمرهها و معدل وزنی"
                  to="/grades"
                />
                <MeNavRow
                  icon="i-notebook"
                  title="دفتر من"
                  sub="یادداشتها و خطکشیدههای جزوهها"
                  to="/me/notes"
                />
                <MeNavRow
                  icon="i-pencil-ruler"
                  title="سؤالهای طراحیشده"
                  sub="سؤالسازی، پیگیری تأیید و چالش پرستیژ"
                  to="/exam/my-designs"
                />
              </div>
            </DsCard>

            <h3 className="acct-group__title">حساب و اشتراک</h3>
            <DsCard flush>
              <div className="ds-list">
                <MeNavRow
                  icon="i-wallet"
                  title="اشتراک و کیفپول"
                  sub="وضعیت اشتراک، خانواده، هدیه و پرداخت"
                  to="/subscription"
                />
                <MeNavRow
                  icon="i-smartphone"
                  title="دستگاههای من"
                  sub="نشستها و دستگاههای متصل"
                  onClick={() => openSheet('devices', false)}
                />
                <MeNavRow
                  icon="i-shield"
                  title="امنیت حساب"
                  sub="محافظت از کد ورود و بررسی نشستها"
                  onClick={() => openSheet('security', false)}
                />
              </div>
            </DsCard>

            <h3 className="acct-group__title">اعلانها</h3>
            <DsCard flush>
              <div className="ds-list">
                <MeNavRow
                  icon="i-inbox"
                  title="صندوق اعلانها"
                  sub="پیامها، سنجاقشدهها و بایگانی"
                  to="/notifications"
                />
                <MeNavRow
                  icon="i-sliders"
                  title="تنظیمات اطلاعرسانی"
                  sub="انتخاب دستههای اعلان (آزمون، برنامه، منابع، هوشیار…)"
                  to="/notifications?tab=settings"
                />
              </div>
            </DsCard>

            <h3 className="acct-group__title">کمک و پشتیبانی</h3>
            <DsCard flush>
              <div className="ds-list">
                <MeNavRow
                  icon="i-help-circle"
                  title="راهنما و پرسشهای متداول"
                  sub="جستوجو در پرسشهای پرتکرار و راهنمای نصب"
                  onClick={() => openSheet('faq', false)}
                />
                <MeNavRow
                  icon="i-lifebuoy"
                  title="پشتیبانی و تیکتها"
                  sub="ارسال درخواست و گفتگو با تیم پشتیبانی"
                  to="/tickets"
                />
                <MeNavRow
                  icon="i-flag"
                  title="گزارشهای ایراد محتوا"
                  sub="ثبت و پیگیری ایراد سؤالها و فایلها"
                  to="/me/reports"
                />
              </div>
            </DsCard>

            <h3 className="acct-group__title">هامزیار</h3>
            <DsCard flush>
              <div className="ds-list">
                {donation?.enabled && donation.link && (
                  <a className="ds-row acct-row--heart" href={donation.link} target="_blank" rel="noopener noreferrer">
                    <span className="ds-row__icon" aria-hidden="true">
                      <Icon name="i-heart" size={20} />
                    </span>
                    <span className="ds-row__body">
                      <span className="ds-row__title">حمایت از هامزیار</span>
                      <span className="ds-row__sub">همراهی برای توسعهٔ امکانات رایگان دانشجویی</span>
                    </span>
                    <Icon name="i-chevron-r" size={18} className="ds-row__chev" />
                  </a>
                )}
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
        size={activeSheet === 'profile' || activeSheet === 'faq' ? 'auto' : 'compact'}
        onBack={
          activeSheet === 'devices' && devicesFromSecurity
            ? () => openSheet('security', false)
            : undefined
        }
        backLabel="بازگشت به امنیت حساب"
      >
        {activeSheet === 'profile' && (
          <div key="profile" className="acct-sheet-body mo-sheet-swap" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <DsCard level="sunken" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label className="ds-field__label">نام و نام خانوادگی</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="ds-input"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={50}
                />
                <DsButton variant="primary" size="sm" disabled={savingField === 'name'} onClick={() => void saveName()}>
                  ذخیره
                </DsButton>
              </div>
            </DsCard>

            <DsCard level="sunken" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label className="ds-field__label">لقب نمایشی (برای نمایش در لیدربرد)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="ds-input"
                  value={nicknameInput}
                  onChange={(e) => setNicknameInput(e.target.value)}
                  placeholder="خالی بگذارید تا حذف شود"
                  maxLength={40}
                />
                <DsButton
                  variant="secondary"
                  size="sm"
                  disabled={savingField === 'nickname' || profileUser?.can_change_nickname === false}
                  onClick={() => void saveNickname()}
                >
                  ثبت
                </DsButton>
              </div>
              {profileUser && !profileUser.can_change_nickname && profileUser.next_change_at && (
                <span className="ds-field__hint">
                  تغییر لقب بعدی از: {profileUser.next_change_at}
                </span>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <span style={{ fontSize: '0.84rem' }}>نمایش نام واقعی کنار/جایگزین لقب</span>
                <Switch
                  label="نمایش نام واقعی"
                  checked={profileUser?.show_real_name ?? true}
                  onChange={(v) => void savePrivacy(v)}
                />
              </div>
            </DsCard>

            <DsCard level="sunken" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label className="ds-field__label">شمارهٔ دانشجویی</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="ds-input ds-input--ltr"
                  value={studentIdInput}
                  onChange={(e) => setStudentIdInput(e.target.value)}
                  maxLength={20}
                />
                <DsButton variant="secondary" size="sm" disabled={savingField === 'sid'} onClick={() => void saveStudentId()}>
                  ثبت
                </DsButton>
              </div>
            </DsCard>

            <DsCard level="sunken" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label className="ds-field__label">گروه ثابت کلاسی</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <DsChip selected={(profileUser?.registered_group || profileUser?.group || user?.group) === '1'} onClick={() => void saveGroup('1')}>
                  گروه ۱
                </DsChip>
                <DsChip selected={(profileUser?.registered_group || profileUser?.group || user?.group) === '2'} onClick={() => void saveGroup('2')}>
                  گروه ۲
                </DsChip>
              </div>

              <label className="ds-field__label" style={{ marginTop: 6 }}>گروه آموزشی برنامه هفتگی</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <DsChip selected={profileUser?.educational_group === 'male'} onClick={() => void saveEduGroup('male')}>
                  برادران
                </DsChip>
                <DsChip selected={profileUser?.educational_group === 'female'} onClick={() => void saveEduGroup('female')}>
                  خواهران
                </DsChip>
              </div>
            </DsCard>

            {intakes.length > 0 && (
              <DsCard level="sunken" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label className="ds-field__label" htmlFor="me-intake-select">ورودی تحصیلی</label>
                <select
                  id="me-intake-select"
                  className="ds-input"
                  value={selectedIntake}
                  disabled={savingField === 'intake'}
                  onChange={(e) => void saveIntake(e.target.value)}
                >
                  {intakes.map((it) => (
                    <option key={it.code} value={it.code}>
                      {it.label}
                    </option>
                  ))}
                </select>
              </DsCard>
            )}
          </div>
        )}

        {activeSheet === 'security' && (
          <div key="security" className="acct-sheet-body mo-sheet-swap">
            <ul className="acct-sheet__list">
              <li className="acct-sheet__item">
                <span className="acct-sheet__item-title">کد ورود اختصاصی (۸ کاراکتری)</span>
                <p className="acct-sheet__item-body">
                  برای ورود روی دستگاه‌های دیگر از این کد ۸ کاراکتری استفاده کنید. هر زمان بخواهید می‌توانید از
                  کارت کد ورود همین صفحه یک کد تازه بسازید تا کد قبلی منقضی شود.
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
          <div key="faq" className="acct-sheet-body mo-sheet-swap" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="search"
              className="ds-input"
              placeholder="جست‌وجو در پرسش‌ها (مثلاً: اشتراک، آزمون، جزوه)…"
              value={faqQuery}
              onChange={(e) => setFaqQuery(e.target.value)}
            />

            {faqSearchResults !== null ? (
              faqSearchResults.length === 0 ? (
                <p className="ds-card__sub">پاسخی با این عبارت پیدا نشد.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {faqSearchResults.map((item) => (
                    <DsCard key={item.id} level="sunken">
                      <strong style={{ display: 'block', marginBottom: 4 }}>{item.question}</strong>
                      <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--ink-2)', lineHeight: 1.7 }}>
                        {item.answer}
                      </p>
                    </DsCard>
                  ))}
                </div>
              )
            ) : faqCategories.length > 0 ? (
              faqCategories.map((cat) => (
                <div key={cat.name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <h4 style={{ margin: '6px 0 2px', fontSize: '0.88rem', color: 'var(--brand)' }}>{cat.name}</h4>
                  {cat.items.map((item) => {
                    const isOpen = faqOpenId === item.id;
                    return (
                      <DsCard key={item.id} level="sunken">
                        <button
                          type="button"
                          onClick={() => setFaqOpenId(isOpen ? null : item.id)}
                          style={{
                            width: '100%',
                            textAlign: 'right',
                            background: 'none',
                            border: 0,
                            color: 'inherit',
                            font: 'inherit',
                            fontWeight: 700,
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          {item.question}
                        </button>
                        {isOpen && (
                          <p style={{ margin: '8px 0 0', fontSize: '0.84rem', color: 'var(--ink-2)', lineHeight: 1.7 }}>
                            {item.answer}
                          </p>
                        )}
                      </DsCard>
                    );
                  })}
                </div>
              ))
            ) : (
              <ul className="acct-sheet__list">
                <li className="acct-sheet__item">
                  <span className="acct-sheet__item-title">یادداشت‌های جزوه کجا ذخیره می‌شوند؟</span>
                  <p className="acct-sheet__item-body">
                    همهٔ خط‌کشیده‌ها و حاشیه‌نویسی‌های شما داخل کتابخوان به‌صورت خودکار ذخیره و در بخش «دفتر من» نگهداری می‌شوند.
                  </p>
                </li>
                <li className="acct-sheet__item">
                  <span className="acct-sheet__item-title">آزمون زمان‌دار چطور کار می‌کند؟</span>
                  <p className="acct-sheet__item-body">
                    مهلت آزمون از سرور کنترل می‌شود و در میانهٔ آزمون پاسخ درست نمایش داده نمی‌شود تا شبیه‌سازی واقعی امتحان حفظ شود.
                  </p>
                </li>
              </ul>
            )}

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
                  پلتفرم یکپارچهٔ دانشجویان علوم پزشکی برای دسترسی سریع به جزوه‌ها و اسلایدها، بانک سؤال بالینی،
                  آزمون‌های زمان‌دار، برنامهٔ مطالعه و دستیار هوشمند هوشیار در یک فضای یکدست.
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

      <Toast message={toast} />
    </>
  );
}
