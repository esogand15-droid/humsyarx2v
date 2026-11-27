import { useCallback, useEffect, useState } from 'react';
import { ErrorBlock, LoadingBlock } from '../../components/AccessStates';
import { DsBadge, DsCard, DsChip, DsEmpty } from '../../design/components';
import { Icon } from '../../icons';
import { faNum } from '../../lib/fa';
import { humanSize } from '../../lib/library';
import { reader, type DocBlock, type OfficePayload, type Scope } from '../../lib/reader';
import './office-viewer.css';

export interface DocumentViewProps {
  scope: Scope;
  id: string;
  initialData?: OfficePayload | null;
  onSwitchToPdf?: (manifestUrl: string) => void;
}

export function DocumentView({ scope, id, initialData = null, onSwitchToPdf }: DocumentViewProps) {
  const [data, setData] = useState<OfficePayload | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<unknown>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [sheetFilter, setSheetFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await reader.office(scope, id);
      if (res.redirect_manifest && onSwitchToPdf) {
        onSwitchToPdf(res.redirect_manifest);
        return;
      }
      setData(res);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [scope, id, onSwitchToPdf]);

  useEffect(() => {
    if (!initialData) void load();
  }, [initialData, load]);

  if (loading) return <LoadingBlock rows={3} />;
  if (error != null) return <ErrorBlock error={error} onRetry={load} />;
  if (!data) return null;

  const downloadAction = data.allow_download && data.download_url && (
    <a className="ds-btn ds-btn--primary ds-btn--sm" href={data.download_url} download>
      <Icon name="i-download" size={16} />
      دانلود فایل ({humanSize(data.size || 0) || data.format?.toUpperCase()})
    </a>
  );

  /* ۱) آرشیو فشرده (ZIP) */
  if (data.kind === 'archive' && data.entries) {
    return (
      <div className="doc-viewer">
        <DsCard className="doc-viewer__header">
          <div className="doc-viewer__meta">
            <div>
              <h2 className="h3" style={{ margin: 0 }}>{data.name || 'بسته فشرده'}</h2>
              <p className="small muted" style={{ margin: '4px 0 0' }}>
                {faNum(data.total_entries || data.entries.length)} فایل داخل آرشیو · حجم بازشده{' '}
                {humanSize(data.total_size || 0) || '—'}
              </p>
            </div>
            {downloadAction}
          </div>
        </DsCard>

        <DsCard flush>
          <div className="ds-list">
            {data.entries.map((entry, idx) => (
              <div key={idx} className="ds-list__row" style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <Icon name={entry.is_dir ? 'i-layers' : 'i-doc'} size={17} />
                  <span className="small" style={{ direction: 'ltr', textAlign: 'left', overflowWrap: 'anywhere' }}>
                    {entry.name}
                  </span>
                </div>
                <span className="tiny muted" style={{ flexShrink: 0 }}>
                  {entry.is_dir ? 'پوشه' : humanSize(entry.size) || '۰ بایت'}
                </span>
              </div>
            ))}
          </div>
        </DsCard>
      </div>
    );
  }

  /* ۲) اکسل / CSV */
  if (data.kind === 'sheet' && data.sheets) {
    const sheets = data.sheets;
    const active = sheets[Math.min(sheetIdx, Math.max(0, sheets.length - 1))];
    const q = sheetFilter.trim().toLowerCase();
    const rows = active
      ? active.rows.filter((r, i) => i === 0 || !q || r.some((cell) => cell.toLowerCase().includes(q)))
      : [];

    return (
      <div className="doc-viewer">
        <DsCard className="doc-viewer__header">
          <div className="doc-viewer__meta">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {sheets.map((s, idx) => (
                <DsChip key={s.name} selected={idx === sheetIdx} onClick={() => setSheetIdx(idx)}>
                  {s.name}
                </DsChip>
              ))}
            </div>
            {downloadAction}
          </div>
          <input
            type="search"
            className="ds-input"
            value={sheetFilter}
            onChange={(e) => setSheetFilter(e.target.value)}
            placeholder="جستجو در ردیف‌های جدول…"
            style={{ marginTop: 10, width: '100%' }}
          />
        </DsCard>

        {active && rows.length > 0 ? (
          <DsCard flush>
            <div className="sheet-table-wrap">
              <table className="sheet-table">
                <tbody>
                  {rows.map((row, rIdx) => (
                    <tr key={rIdx} className={rIdx === 0 ? 'is-head' : ''}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {active.truncated && (
              <p className="tiny muted" style={{ padding: 12, margin: 0 }}>
                به علت حجم بالای فایل، بخشی از ردیف‌ها نمایش داده شد؛ برای جدول کامل دانلود کنید.
              </p>
            )}
          </DsCard>
        ) : (
          <DsCard>
            <DsEmpty icon={<Icon name="i-grid" size={28} />} title="جدولی یافت نشد" body="این شیت خالی است." />
          </DsCard>
        )}
      </div>
    );
  }

  /* ۳) سند ورد ساختاریافته (DOCX) */
  if (data.blocks && data.blocks.length > 0) {
    const assets = data.asset_urls || {};
    return (
      <div className="doc-viewer">
        <DsCard className="doc-viewer__header">
          <div className="doc-viewer__meta">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <DsBadge tone="accent">{(data.format || 'DOCX').toUpperCase()}</DsBadge>
              <span className="small muted">{data.name}</span>
            </div>
            {downloadAction}
          </div>
        </DsCard>

        <DsCard className="doc-paper">
          {data.blocks.map((b: DocBlock, idx: number) => {
            if (b.type === 'image' && b.asset && assets[b.asset]) {
              return (
                <div key={idx} className="doc-paper__img">
                  <img src={assets[b.asset]} alt="" loading="lazy" />
                </div>
              );
            }
            if (b.type === 'table' && b.rows) {
              return (
                <div key={idx} className="sheet-table-wrap" style={{ marginBlock: 12 }}>
                  <table className="sheet-table">
                    <tbody>
                      {b.rows.map((row, rIdx) => (
                        <tr key={rIdx}>
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} dir={cell.rtl ? 'rtl' : 'ltr'}>
                              {cell.text}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }
            const dir = b.rtl ? 'rtl' : 'ltr';
            const content = (b.runs || []).length
              ? (b.runs || []).map((r, rIdx) => (
                  <span
                    key={rIdx}
                    style={{
                      fontWeight: r.bold ? 700 : undefined,
                      fontStyle: r.italic ? 'italic' : undefined,
                      textDecoration: r.underline ? 'underline' : undefined,
                      color: r.color || undefined,
                    }}
                  >
                    {r.text}
                  </span>
                ))
              : b.text;

            if (b.type === 'heading') {
              const tagLevel = Math.min(4, Math.max(1, b.level || 2));
              return (
                <div
                  key={idx}
                  dir={dir}
                  className={`doc-paper__h doc-paper__h${tagLevel}`}
                  style={{ textAlign: (b.align as 'left' | 'right' | 'center') || (b.rtl ? 'right' : 'left') }}
                >
                  {content}
                </div>
              );
            }
            return (
              <p
                key={idx}
                dir={dir}
                className={b.type === 'list_item' ? 'doc-paper__li' : 'doc-paper__p'}
                style={{ textAlign: (b.align as 'left' | 'right' | 'center' | 'justify') || (b.rtl ? 'right' : 'left') }}
              >
                {b.type === 'list_item' ? '• ' : ''}
                {content}
              </p>
            );
          })}
        </DsCard>
      </div>
    );
  }

  /* ۴) متن / مارک‌داون / DOC قدیمی استخراج‌شده */
  if (typeof data.text === 'string' && data.text.trim().length > 0) {
    return (
      <div className="doc-viewer">
        <DsCard className="doc-viewer__header">
          <div className="doc-viewer__meta">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <DsBadge tone="accent">{(data.format || 'TXT').toUpperCase()}</DsBadge>
              <span className="small muted">{data.name}</span>
            </div>
            {downloadAction}
          </div>
          {data.is_legacy_binary && (
            <p className="tiny muted" style={{ margin: '8px 0 0' }}>
              فایل با فرمت قدیمی ذخیره شده؛ متن استخراج‌شده را اینجا می‌بینید و نسخهٔ کامل نیز قابل دانلود است.
            </p>
          )}
        </DsCard>
        <DsCard className="doc-paper">
          <pre
            dir={data.rtl ? 'rtl' : 'ltr'}
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: data.format === 'json' || data.format === 'xml' ? 'monospace' : 'inherit',
              margin: 0,
              lineHeight: 1.8,
              fontSize: 14,
            }}
          >
            {data.text}
          </pre>
        </DsCard>
      </div>
    );
  }

  /* ۵) سایر فایل‌های ضمیمه — نمایش مشخصات و دانلود مستقیم در مرورگر */
  return (
    <div className="doc-viewer">
      <DsCard>
        <DsEmpty
          icon={<Icon name="i-doc" size={28} />}
          title={data.name || 'فایل ضمیمه'}
          body={`فرمت: ${(data.ext || data.format || 'فایل').toUpperCase()} ${data.size ? `· حجم: ${humanSize(data.size)}` : ''}`}
          action={
            data.download_url ? (
              <a className="ds-btn ds-btn--primary" href={data.download_url} download>
                <Icon name="i-download" size={16} />
                دانلود و باز کردن فایل
              </a>
            ) : undefined
          }
        />
      </DsCard>
    </div>
  );
}
