import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppBar, SkeletonStack, Toast } from '../components';
import { DsBadge, DsButton, DsCard, DsChip, DsEmpty } from '../design/components';
import { Icon } from '../icons';
import { errorText } from '../lib/api';
import { faNum } from '../lib/fa';
import { profileApi, type FeedItem, type LeaderboardPayload } from '../lib/profile';

const RANGES = [
  ['week', 'هفته'],
  ['month', 'ماه'],
  ['all', 'کل'],
  ['season', 'سیزن'],
] as const;

const SCOPES = [
  ['all', 'همه'],
  ['intake', 'ورودی من'],
  ['group', 'گروه من'],
] as const;

const TABS = [
  ['xp', 'XP', 'XP'],
  ['acc', 'دقت', '٪'],
  ['exam', 'آزمون', 'آزمون'],
  ['contrib', 'مشارکت', 'سؤال'],
] as const;

const REACTIONS: Array<{ kind: 'clap' | 'fire' | 'crown'; label: string }> = [
  { kind: 'clap', label: '👏 تشویق' },
  { kind: 'fire', label: '🔥 عالی' },
  { kind: 'crown', label: '👑 طلایی' },
];

export function LeaderboardScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const [range, setRange] = useState('week');
  const [scope, setScope] = useState('all');
  const [tab, setTab] = useState('xp');
  const [data, setData] = useState<LeaderboardPayload | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [boardRes, feedRes] = await Promise.all([
        profileApi.leaderboard({ range_: range, scope, tab, limit: 50 }),
        profileApi.feed(6).catch(() => ({ items: [] })),
      ]);
      setData(boardRes);
      setFeed(feedRes.items || []);
    } catch (e) {
      setErr(errorText(e, 'دریافت جدول رقابت انجام نشد.'));
    } finally {
      setLoading(false);
    }
  }, [range, scope, tab]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  async function toggleReaction(item: FeedItem, kind: 'clap' | 'fire' | 'crown') {
    const nextKind = item.my_reaction === kind ? null : kind;
    try {
      await profileApi.reactFeed(item.id, nextKind);
      setFeed((prev) =>
        prev.map((row) => {
          if (row.id !== item.id) return row;
          const counts = { ...(row.reactions || {}) };
          if (row.my_reaction && counts[row.my_reaction]) {
            counts[row.my_reaction] = Math.max(0, counts[row.my_reaction] - 1);
          }
          if (nextKind) {
            counts[nextKind] = (counts[nextKind] || 0) + 1;
          }
          return { ...row, reactions: counts, my_reaction: nextKind };
        }),
      );
    } catch (e) {
      setToast(errorText(e, 'ثبت واکنش انجام نشد.'));
    }
  }

  const unit = TABS.find((t) => t[0] === tab)?.[2] || 'XP';
  const rows = data?.rows || [];
  const me = data?.me;

  return (
    <>
      {!embedded && (<AppBar
        title="میدان رقابت"
        sub="رتبه‌بندی هوشمند، پیشرفت هفتگی و تازه‌های دانشجویان"
        back
        actions={
          <Link className="ds-btn ds-btn--ghost ds-btn--sm" to="/me/badges">
            <Icon name="i-award" size={16} />
            <span>نشان‌ها</span>
          </Link>
        }
      />)}

      <div className={embedded ? 'lb-embedded' : 'page page-enter'} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <DsCard style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {RANGES.map(([k, lbl]) => (
              <DsChip key={k} selected={range === k} onClick={() => setRange(k)}>
                {lbl}
              </DsChip>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SCOPES.map(([k, lbl]) => (
              <DsChip key={k} selected={scope === k} onClick={() => setScope(k)}>
                {lbl}
              </DsChip>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TABS.map(([k, lbl]) => (
              <DsChip key={k} selected={tab === k} onClick={() => setTab(k)}>
                {lbl}
              </DsChip>
            ))}
          </div>
        </DsCard>

        {range === 'season' && data?.season?.label && (
          <DsCard level="sunken">
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <DsBadge tone="accent">{data.season.label}</DsBadge>
              <span style={{ fontSize: '0.82rem', color: 'var(--ink-2)' }}>
                جدول کل هرگز ریست نمی‌شود
              </span>
            </div>
          </DsCard>
        )}

        {me && (
          <DsCard level="accent">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>
                  رتبه شما: #{faNum(me.rank)} {me.icon || ''}
                </div>
                <div style={{ fontSize: '0.84rem', color: 'var(--ink-2)', marginTop: 4 }}>
                  {me.name || 'شما'} {me.roman ? `(${me.roman})` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 800 }}>
                  {faNum(me.value)} {unit}
                </div>
                {typeof me.jump === 'number' && me.jump !== 0 && (
                  <DsBadge tone={me.jump > 0 ? 'success' : 'warning'}>
                    {me.jump > 0 ? `▲ ${faNum(me.jump)}` : `▼ ${faNum(Math.abs(me.jump))}`} نسبت به هفته قبل
                  </DsBadge>
                )}
              </div>
            </div>
            {(data?.rival_above || data?.rival_below) && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: '0.8rem', color: 'var(--ink-2)' }}>
                {data?.rival_above && (
                  <span>
                    بالاتر: {data.rival_above.name} (فاصله {faNum(data.rival_above.gap)} XP)
                  </span>
                )}
                {data?.rival_below && (
                  <span>
                    پایین‌تر: {data.rival_below.name} (فاصله {faNum(data.rival_below.gap)} XP)
                  </span>
                )}
              </div>
            )}
          </DsCard>
        )}

        {err && (
          <DsCard>
            <p style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>
            <div style={{ marginTop: 8 }}>
              <DsButton variant="secondary" size="sm" onClick={() => void loadBoard()}>
                تلاش دوباره
              </DsButton>
            </div>
          </DsCard>
        )}

        {loading ? (
          <SkeletonStack rows={5} />
        ) : rows.length === 0 ? (
          <DsCard>
            <DsEmpty
              icon={<Icon name="i-award" size={28} />}
              title="جدول این بازه هنوز خالی است"
              body="با پاسخ به تست‌ها و فعالیت در بانک سؤال، اولین رتبه را ثبت کنید."
            />
          </DsCard>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((row) => (
              <DsCard key={`${row.uid}-${row.rank}`} level={row.is_me ? 'raised' : 'default'}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <DsBadge tone={row.rank <= 3 ? 'warning' : row.is_me ? 'accent' : 'neutral'}>
                      #{faNum(row.rank)}
                    </DsBadge>
                    <div>
                      <div style={{ fontWeight: row.is_me ? 800 : 600 }}>
                        {row.icon ? `${row.icon} ` : ''}
                        {row.name}
                        {row.is_me ? ' (شما)' : ''}
                      </div>
                      {row.roman && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--ink-2)' }}>{row.roman}</div>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'left', fontWeight: 700 }}>
                    {faNum(row.value)} {unit}
                  </div>
                </div>
              </DsCard>
            ))}
          </div>
        )}

        {feed.length > 0 && (
          <DsCard level="sunken" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>تازه‌های میدان (۴۸ ساعت اخیر)</h2>
              <Link className="ds-btn ds-btn--ghost ds-btn--sm" to="/exam/challenge">
                چالش پرستیژ
              </Link>
            </div>
            {feed.map((item) => (
              <DsCard key={item.id}>
                <p style={{ margin: '0 0 8px', fontSize: '0.88rem', lineHeight: 1.7 }}>{item.text}</p>
                {item.at_jalali && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--ink-2)', marginBottom: 8 }}>{item.at_jalali}</div>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {REACTIONS.map((r) => (
                    <DsChip
                      key={r.kind}
                      selected={item.my_reaction === r.kind}
                      onClick={() => void toggleReaction(item, r.kind)}
                    >
                      {r.label} ({faNum(item.reactions?.[r.kind] || 0)})
                    </DsChip>
                  ))}
                </div>
              </DsCard>
            ))}
          </DsCard>
        )}
      </div>

      <Toast message={toast} />
    </>
  );
}
