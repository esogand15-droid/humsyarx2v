import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import './badges.css';
import { AppBar, ProgressBar, Switch, Toast } from '../components';
import { DsBadge, DsButton, DsCard, DsEmpty, DsSegmented, DsSkeleton } from '../design/components';
import { Icon } from '../icons';
import { errorText } from '../lib/api';
import { faNum } from '../lib/fa';
import {
  profileApi,
  type BadgesPayload,
  type PrestigeHistoryItem,
  type PrestigeState,
} from '../lib/profile';
import { peek, put } from '../lib/swr';
import { LeaderboardScreen } from './LeaderboardScreen';

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

type Tab = 'badges' | 'journey' | 'compete';
const TABS: Tab[] = ['badges', 'journey', 'compete'];

interface HubData {
  prestige: PrestigeState | null;
  badges: BadgesPayload | null;
  history: PrestigeHistoryItem[];
}

const CACHE_KEY = 'me:prestige-hub';

/** «رقابت و دستاورد‌ها» — نشانها، سفر پیشرفت و میدان رقابت در یک بخش. */
export function BadgesScreen() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'badges';
  const setTab = (t: Tab) => setParams(t === 'badges' ? {} : { tab: t }, { replace: true });

  // Cached data paints the whole screen at once; the fetch only refreshes it.
  const [data, setData] = useState<HubData | null>(() => peek<HubData>(CACHE_KEY) ?? null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const update = useCallback((fn: (d: HubData) => HubData) => {
    setData((prev) => (prev ? put(CACHE_KEY, fn(prev)) : prev));
  }, []);

  const loadAll = useCallback(async () => {
    setErr('');
    try {
      const [pRes, bRes, hRes] = await Promise.all([
        profileApi.prestige(),
        profileApi.prestigeBadges(),
        profileApi.prestigeHistory(40),
      ]);
      setData(
        put(CACHE_KEY, {
          prestige: pRes.prestige || null,
          badges: bRes.badges || null,
          history: hRes.items || [],
        }),
      );
    } catch (e) {
      setErr(errorText(e, 'دریافت اطلاعات پرستیژ و نشان‌ها ناموفق بود.'));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const prestige = data?.prestige ?? null;
  const badges = data?.badges ?? null;
  const history = data?.history ?? [];
  const showcase = badges?.showcase || [];
  const progressive = badges?.progressive || [];
  const singles = useMemo(() => badges?.singles || [], [badges]);
  const globals = badges?.global || [];
  const earnedCount = singles.filter((s) => s.earned).length;
  const byKey = useMemo(() => new Map(singles.map((s) => [s.key, s])), [singles]);

  async function togglePin(key: string, earned: boolean) {
    if (!earned || !badges) return;
    if (!showcase.includes(key) && showcase.length >= 3) {
      setToast('حداکثر ۳ نشان می‌توانید در ویترین سنجاق کنید.');
      return;
    }
    const next = showcase.includes(key) ? showcase.filter((k) => k !== key) : [...showcase, key].slice(0, 3);
    try {
      const res = await profileApi.setShowcase(next);
      const updated = res.showcase?.map((x) => x.key).filter(Boolean) || next;
      update((d) => (d.badges ? { ...d, badges: { ...d.badges, showcase: updated } } : d));
      setToast('ویترین نشان‌ها به‌روز شد.');
    } catch (e) {
      setToast(errorText(e, 'به‌روزرسانی ویترین ناموفق بود.'));
    }
  }

  async function togglePrivacy(nextVal: boolean) {
    try {
      const res = await profileApi.setPrestigePrivacy(nextVal);
      update((d) => (d.prestige ? { ...d, prestige: { ...d.prestige, privacy_public: res.privacy_public } } : d));
      setToast(res.privacy_public ? 'نمایش پروفایل در رقابت عمومی روشن شد.' : 'حالت ناشناس در رقابت فعال شد.');
    } catch (e) {
      setToast(errorText(e, 'تغییر حریم عمومی ناموفق بود.'));
    }
  }

  const xp = prestige?.xp ?? 0;
  const nextXp = prestige?.next_tier_xp ?? null;
  const tierPct = nextXp && nextXp > 0 ? Math.min(100, (xp / nextXp) * 100) : 100;

  return (
    <>
      <AppBar title="رقابت و دستاورد‌ها" sub="نشانها، سفر پیشرفت و میدان رقابت" back />

      <div className="page page-enter bdg">
        {!data && !err ? (
          <HubSkeleton />
        ) : !data ? (
          <DsCard>
            <p className="bdg-error">{err}</p>
            <DsButton variant="secondary" size="sm" onClick={() => void loadAll()}>
              تلاش دوباره
            </DsButton>
          </DsCard>
        ) : (
          <>
            <section className="bdg-hero" aria-label="سطح پرستیژ">
              <div className="bdg-hero__top">
                <span className="bdg-hero__emblem" aria-hidden="true">
                  {prestige?.tier_icon || '🏅'}
                </span>
                <div className="bdg-hero__id">
                  <span className="bdg-hero__eyebrow">پلهٔ {faNum(prestige?.tier ?? 1)}</span>
                  <h2 className="bdg-hero__tier">{prestige?.tier_name || 'سطح فعلی'}</h2>
                </div>
                <div className="bdg-hero__xp">
                  <bdi>{faNum(xp)}</bdi>
                  <span>XP</span>
                </div>
              </div>
              <ProgressBar value={tierPct} thin />
              <p className="bdg-hero__hint">
                {nextXp && nextXp > xp ? `${faNum(nextXp - xp)} XP تا پلهٔ بعد` : 'بالاترین پلهٔ فعلی را فتح کرده‌اید'}
                {typeof prestige?.effective_xp === 'number' && ` · امتیاز مؤثر ${faNum(prestige.effective_xp)}`}
              </p>
              <div className="bdg-stats">
                <Stat label="نشان باز‌شده" value={`${faNum(earnedCount)} / ${faNum(singles.length)}`} />
                <Stat label="ویترین" value={`${faNum(showcase.length)} / ۳`} />
                <Stat label="رویداد سفر" value={faNum(history.length)} />
              </div>
            </section>

            <DsSegmented
              block
              label="بخش‌های رقابت و دستاورد‌ها"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'badges', label: 'نشان‌ها' },
                { value: 'journey', label: 'سفر من' },
                { value: 'compete', label: 'میدان رقابت' },
              ]}
            />

            {tab === 'badges' && (
              <>
                <DsCard className="bdg-card">
                  <header className="bdg-card__head">
                    <h3>ویترین افتخارات</h3>
                    <span className="bdg-card__meta">روی نشان باز‌شده بزنید تا سنجاق شود</span>
                  </header>
                  <div className="bdg-showcase">
                    {[0, 1, 2].map((i) => {
                      const item = showcase[i] ? byKey.get(showcase[i]) : undefined;
                      return item ? (
                        <button
                          key={i}
                          type="button"
                          className="bdg-slot bdg-slot--filled"
                          onClick={() => void togglePin(item.key, true)}
                          aria-label={`برداشتن ${item.title} از ویترین`}
                        >
                          <span className="bdg-slot__icon">{item.icon}</span>
                          <span className="bdg-slot__title">{item.title}</span>
                        </button>
                      ) : (
                        <div key={i} className="bdg-slot" aria-hidden="true">
                          <Icon name="i-pin" size={16} />
                        </div>
                      );
                    })}
                  </div>
                </DsCard>

                {progressive.length > 0 && (
                  <DsCard className="bdg-card">
                    <header className="bdg-card__head">
                      <h3>نشان‌های تکاملی</h3>
                    </header>
                    <div className="bdg-prog">
                      {progressive.map((b) => {
                        const pct = b.next_target ? Math.min(100, (b.value / b.next_target) * 100) : 100;
                        return (
                          <div key={b.key} className="bdg-prog__row">
                            <span className="bdg-prog__icon" aria-hidden="true">{b.icon}</span>
                            <div className="bdg-prog__body">
                              <div className="bdg-prog__line">
                                <strong>{b.title}</strong>
                                <span className="bdg-card__meta">
                                  پلهٔ {faNum(b.tier)} از {faNum(b.tiers_count)}
                                </span>
                              </div>
                              <ProgressBar value={pct} thin tone={b.next_target ? 'accent' : 'good'} />
                              <span className="bdg-card__meta">
                                {b.next_target
                                  ? `${faNum(b.value)} از ${faNum(b.next_target)} · پاداش پلهٔ بعد ${faNum(b.next_xp ?? 0)} XP`
                                  : 'بالاترین سطح این نشان فتح شده است'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </DsCard>
                )}

                {KIND_ORDER.map((kind) => {
                  const group = singles.filter((s) => s.kind === kind);
                  if (!group.length) return null;
                  return (
                    <DsCard key={kind} className="bdg-card">
                      <header className="bdg-card__head">
                        <h3>{KIND_TITLES[kind] || kind}</h3>
                        <DsBadge>
                          {faNum(group.filter((g) => g.earned).length)} / {faNum(group.length)}
                        </DsBadge>
                      </header>
                      <div className="bdg-grid">
                        {group.map((item) => {
                          const pinned = showcase.includes(item.key);
                          const hidden = Boolean(item.secret) && !item.earned;
                          return (
                            <button
                              key={item.key}
                              type="button"
                              className={`bdg-tile${item.earned ? ' is-earned' : ' is-locked'}${pinned ? ' is-pinned' : ''}`}
                              onClick={() => void togglePin(item.key, item.earned)}
                              disabled={!item.earned}
                              aria-pressed={item.earned ? pinned : undefined}
                            >
                              <span className="bdg-tile__icon" aria-hidden="true">
                                {hidden ? '؟' : item.icon}
                              </span>
                              <span className="bdg-tile__title">{hidden ? 'نشان پنهان' : item.title}</span>
                              <span className="bdg-tile__desc">{hidden ? 'با کشف آن غافلگیر می‌شوید' : item.desc}</span>
                              <span className="bdg-tile__foot">
                                {pinned && <DsBadge tone="accent">سنجاق</DsBadge>}
                                {!item.earned && <DsBadge tone="neutral">قفل</DsBadge>}
                                {item.count && item.count > 1 ? <DsBadge>×{faNum(item.count)}</DsBadge> : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </DsCard>
                  );
                })}

                {globals.length > 0 && (
                  <DsCard className="bdg-card">
                    <header className="bdg-card__head">
                      <h3>نشان‌های جهانی</h3>
                      <span className="bdg-card__meta">هر کدام فقط یک دارنده دارد</span>
                    </header>
                    <div className="bdg-globals">
                      {globals.map((g) => (
                        <div key={g.key} className="bdg-global">
                          <span className="bdg-prog__icon" aria-hidden="true">{g.icon}</span>
                          <strong>{g.title}</strong>
                          <DsBadge tone={g.owned_by_me ? 'success' : g.claimed ? 'neutral' : 'warning'}>
                            {g.claimed ? (g.owned_by_me ? 'متعلق به شما' : `دارنده: ${g.owner_name || 'دانشجو'}`) : 'آزاد'}
                          </DsBadge>
                        </div>
                      ))}
                    </div>
                  </DsCard>
                )}

                {prestige && (
                  <DsCard className="bdg-card bdg-privacy">
                    <div>
                      <h3>نمایش عمومی در رقابت</h3>
                      <span className="bdg-card__meta">نام شما در جدول رقابت و تازه‌ها دیده شود</span>
                    </div>
                    <Switch
                      label="نمایش عمومی در رقابت"
                      checked={prestige.privacy_public !== false}
                      onChange={(v) => void togglePrivacy(v)}
                    />
                  </DsCard>
                )}
              </>
            )}

            {tab === 'journey' &&
              (history.length === 0 ? (
                <DsCard>
                  <DsEmpty
                    icon={<Icon name="i-trophy" size={28} />}
                    title="سفر شما از همین‌جا شروع می‌شود"
                    body="با شرکت در آزمونها، مطالعهٔ جزوه و گفت‌وگو با هوشیار، اولین قدم‌ها اینجا ثبت می‌شوند."
                  />
                </DsCard>
              ) : (
                <DsCard className="bdg-card">
                  <ol className="bdg-timeline">
                    {history.map((item, i) => (
                      <li key={i} className="bdg-timeline__item">
                        <span className="bdg-timeline__dot" aria-hidden="true">
                          {item.icon || '•'}
                        </span>
                        <div className="bdg-timeline__body">
                          <strong>{item.title}</strong>
                          {item.at_jalali && <span className="bdg-card__meta">{item.at_jalali}</span>}
                        </div>
                        {typeof item.delta === 'number' && item.delta !== 0 && (
                          <DsBadge tone={item.delta > 0 ? 'success' : 'neutral'}>
                            {item.delta > 0 ? '+' : '−'}
                            {faNum(Math.abs(item.delta))} XP
                          </DsBadge>
                        )}
                      </li>
                    ))}
                  </ol>
                </DsCard>
              ))}

            {tab === 'compete' && <LeaderboardScreen embedded />}
          </>
        )}
      </div>

      <Toast message={toast} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bdg-stat">
      <bdi className="bdg-stat__value">{value}</bdi>
      <span className="bdg-stat__label">{label}</span>
    </div>
  );
}

/** Same shape as the loaded screen, so nothing jumps when the data lands. */
function HubSkeleton() {
  return (
    <div className="bdg-skel" aria-hidden="true">
      <div className="bdg-hero">
        <div className="bdg-hero__top">
          <DsSkeleton shape="circle" />
          <div className="bdg-skel__id">
            <DsSkeleton shape="text" />
            <DsSkeleton shape="title" />
          </div>
        </div>
        <DsSkeleton shape="text" />
        <div className="bdg-stats">
          <DsSkeleton shape="row" />
          <DsSkeleton shape="row" />
          <DsSkeleton shape="row" />
        </div>
      </div>
      <DsSkeleton shape="row" />
      <div className="bdg-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <DsSkeleton key={i} shape="card" />
        ))}
      </div>
    </div>
  );
}
