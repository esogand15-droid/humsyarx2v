import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppBar, SkeletonStack, Switch, Toast } from '../components';
import { DsBadge, DsButton, DsCard, DsEmpty, DsSegmented } from '../design/components';
import { Icon } from '../icons';
import { errorText } from '../lib/api';
import { faNum } from '../lib/fa';
import {
  profileApi,
  type BadgesPayload,
  type PrestigeHistoryItem,
  type PrestigeState,
} from '../lib/profile';

const KIND_TITLES: Record<string, string> = {
  lifetime: 'لحظه‌ای‌ها',
  accuracy: 'دقت پاسخ‌گویی',
  community: 'مشارکت علمی',
  secret: 'نشان‌های مخفی',
  ancient: 'نشان‌های باستانی',
  founder: 'بنیان‌گذار',
  competition: 'رقابتی',
};

const KIND_ORDER = ['lifetime', 'accuracy', 'community', 'secret', 'ancient', 'competition', 'founder'];

export function BadgesScreen() {
  const [tab, setTab] = useState<'badges' | 'journey'>('badges');
  const [prestige, setPrestige] = useState<PrestigeState | null>(null);
  const [badges, setBadges] = useState<BadgesPayload | null>(null);
  const [history, setHistory] = useState<PrestigeHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [pRes, bRes, hRes] = await Promise.all([
        profileApi.prestige(),
        profileApi.prestigeBadges(),
        profileApi.prestigeHistory(40),
      ]);
      setPrestige(pRes.prestige || null);
      setBadges(bRes.badges || null);
      setHistory(hRes.items || []);
    } catch (e) {
      setErr(errorText(e, 'دریافت اطلاعات پرستیژ و نشان‌ها ناموفق بود.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function togglePin(key: string, earned: boolean) {
    if (!earned || !badges) return;
    const current = badges.showcase || [];
    if (!current.includes(key) && current.length >= 3) {
      setToast('حداکثر ۳ نشان می‌توانید در ویترین سنجاق کنید.');
      return;
    }
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key].slice(0, 3);
    try {
      const res = await profileApi.setShowcase(next);
      const updated = res.showcase?.map((x) => x.key).filter(Boolean) || next;
      setBadges((prev) => (prev ? { ...prev, showcase: updated } : prev));
      setToast('ویترین نشان‌ها بروزرسانی شد.');
    } catch (e) {
      setToast(errorText(e, 'بروزرسانی ویترین ناموفق بود.'));
    }
  }

  async function togglePrivacy(nextVal: boolean) {
    try {
      const res = await profileApi.setPrestigePrivacy(nextVal);
      setPrestige((prev) => (prev ? { ...prev, privacy_public: res.privacy_public } : prev));
      setToast(res.privacy_public ? 'نمایش پروفایل در رقابت عمومی روشن شد.' : 'حالت ناشناس در رقابت فعال شد.');
    } catch (e) {
      setToast(errorText(e, 'تغییر حریم عمومی ناموفق بود.'));
    }
  }

  const showcase = badges?.showcase || [];
  const progressive = badges?.progressive || [];
  const singles = badges?.singles || [];
  const globals = badges?.global || [];

  return (
    <>
      <AppBar
        title="نشان‌ها و پرستیژ من"
        sub="رتبه علمی، ویترین افتخارات و تایم‌لاین پیشرفت"
        back
        actions={
          <Link className="ds-btn ds-btn--ghost ds-btn--sm" to="/leaderboard">
            <Icon name="i-trend" size={16} />
            <span>میدان رقابت</span>
          </Link>
        }
      />

      <div className="page page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading ? (
          <SkeletonStack rows={4} />
        ) : err ? (
          <DsCard>
            <p style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>
            <div style={{ marginTop: 8 }}>
              <DsButton variant="secondary" size="sm" onClick={() => void loadAll()}>
                تلاش دوباره
              </DsButton>
            </div>
          </DsCard>
        ) : (
          <>
            {prestige && (
              <DsCard level="accent" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                      {prestige.tier_icon || '🏅'} {prestige.tier_name || 'سطح فعلی'}
                    </div>
                    <div style={{ fontSize: '0.84rem', color: 'var(--ink-2)', marginTop: 4 }}>
                      امتیاز XP کل: {faNum(prestige.xp ?? 0)}
                      {typeof prestige.effective_xp === 'number' && ` · مؤثر: ${faNum(prestige.effective_xp)}`}
                    </div>
                  </div>
                  <DsBadge tone="success">پله {faNum(prestige.tier ?? 1)}</DsBadge>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: '0.85rem' }}>نمایش عمومی نام من در جدول رقابت و فید</span>
                  <Switch
                    label="نمایش عمومی در رقابت"
                    checked={prestige.privacy_public !== false}
                    onChange={(v) => void togglePrivacy(v)}
                  />
                </div>
              </DsCard>
            )}

            <DsSegmented
              block
              label="بخش‌های پرستیژ"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'badges', label: `کلکسیون نشان‌ها (${faNum(singles.filter((s) => s.earned).length)})` },
                { value: 'journey', label: 'سفر پیشرفت من' },
              ]}
            />

            {tab === 'badges' ? (
              <>
                <DsCard level="sunken">
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    <Icon name="i-pin" size={14} /> ویترین افتخارات ({faNum(showcase.length)} از ۳)
                  </div>
                  <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--ink-2)' }}>
                    {showcase.length > 0
                      ? 'روی هر نشان بازشده بزنید تا در کارت پروفایل عمومی شما سنجاق یا حذف شود.'
                      : 'هنوز نشانی پین نکرده‌اید؛ روی یکی از نشان‌های بازشده ضربه بزنید.'}
                  </p>
                </DsCard>

                {progressive.length > 0 && (
                  <DsCard style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>نشان‌های تکاملی</h2>
                    {progressive.map((b) => (
                      <DsCard key={b.key} level="sunken">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <strong>
                            {b.icon} {b.title}
                          </strong>
                          <DsBadge tone="accent">
                            پله {faNum(b.tier)} / {faNum(b.tiers_count)}
                          </DsBadge>
                        </div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--ink-2)', marginTop: 6 }}>
                          {b.next_target
                            ? `${faNum(b.value)} از ${faNum(b.next_target)} · پله بعدی: +${faNum(b.next_xp ?? 0)} XP`
                            : 'بالاترین سطح این نشان فتح شده است!'}
                        </div>
                      </DsCard>
                    ))}
                  </DsCard>
                )}

                {KIND_ORDER.map((kind) => {
                  const group = singles.filter((s) => s.kind === kind);
                  if (!group.length) return null;
                  return (
                    <DsCard key={kind} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700 }}>
                          {KIND_TITLES[kind] || kind}
                        </h3>
                        <DsBadge>
                          {faNum(group.filter((g) => g.earned).length)} / {faNum(group.length)}
                        </DsBadge>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 8 }}>
                        {group.map((item) => {
                          const isPinned = showcase.includes(item.key);
                          return (
                            <button
                              key={item.key}
                              type="button"
                              className="ds-card"
                              onClick={() => void togglePin(item.key, item.earned)}
                              style={{
                                textAlign: 'right',
                                opacity: item.earned || item.secret ? 1 : 0.55,
                                borderColor: isPinned ? 'var(--brand)' : undefined,
                                cursor: item.earned ? 'pointer' : 'default',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                                <strong>
                                  {item.icon} {item.title}
                                </strong>
                                {isPinned && <DsBadge tone="accent">سنجاق</DsBadge>}
                              </div>
                              <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: 'var(--ink-2)', lineHeight: 1.6 }}>
                                {item.desc}
                              </p>
                              {item.count && item.count > 1 && (
                                <DsBadge tone="neutral">×{faNum(item.count)} بار</DsBadge>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </DsCard>
                  );
                })}

                {globals.length > 0 && (
                  <DsCard style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>نشان‌های جهانی (تک‌مالکی)</h2>
                    {globals.map((g) => (
                      <DsCard key={g.key} level="sunken">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <strong>
                            {g.icon} {g.title}
                          </strong>
                          <DsBadge tone={g.owned_by_me ? 'success' : g.claimed ? 'neutral' : 'warning'}>
                            {g.claimed ? (g.owned_by_me ? 'متعلق به شما' : `دارنده: ${g.owner_name || 'دانشجو'}`) : 'آزاد'}
                          </DsBadge>
                        </div>
                      </DsCard>
                    ))}
                  </DsCard>
                )}
              </>
            ) : history.length === 0 ? (
              <DsCard>
                <DsEmpty
                  icon={<Icon name="i-award" size={28} />}
                  title="هنوز رویدادی در سفر شما ثبت نشده"
                  body="با شرکت در آزمون‌ها، دانلود جزوه و گفت‌وگو با هوشیار سفر خود را شروع کنید."
                />
              </DsCard>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map((item, i) => (
                  <DsCard key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <strong>
                        {item.icon ? `${item.icon} ` : ''}
                        {item.title}
                      </strong>
                      {typeof item.delta === 'number' && item.delta !== 0 && (
                        <DsBadge tone={item.delta > 0 ? 'success' : 'neutral'}>
                          +{faNum(item.delta)} XP
                        </DsBadge>
                      )}
                    </div>
                    {item.at_jalali && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--ink-2)', marginTop: 4 }}>{item.at_jalali}</div>
                    )}
                  </DsCard>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <Toast message={toast} />
    </>
  );
}
