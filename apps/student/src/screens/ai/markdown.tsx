/* رندرکنندهٔ مارکداون سبک برای پاسخهای هوشیار — بدون وابستگی و بدون
   dangerouslySetInnerHTML: خروجی فقط عناصر React است، پس HTML مدل هرگز
   اجرا نمیشود (امن در برابر XSS).

   پشتیبانی: سرتیتر، پاراگراف، فهرست مرتب/نامرتب (تودرتو با تورفتگی)،
   نقلقول، خط افقی، بلوک کد با دکمهٔ کپی، جدول GFM، کد درونخطی، پررنگ،
   مورب، پیوند و پیوند خودکار.

   راستبهچپ: جهت هر بلوک از نسبت حروف فارسی تعیین میشود (≥۳۰٪ ⇒ rtl)،
   چون dir="auto" پاراگراف فارسیای را که با «ECG» شروع شود چپچین میکند.
   در بلوکهای rtl، توالیهای لاتین (نام دارو، واحد mg/dL) در <bdi> میروند. */
import { Fragment, useState, type ReactNode } from 'react';
import { Icon } from '../../icons';

type Dir = 'rtl' | 'ltr';

const RTL_WORD = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_WORD = /[A-Za-z\u00C0-\u024F]/;

/** جهت یک بلوک بر پایهٔ «واژه»، نه نویسه: نام داروها و اصطلاحات لاتین
    بلندند و شمارش نویسه پاراگراف فارسی را به اشتباه ltr میکرد. کد، URL و
    نشانهگذاری مارکداون رأی نمیدهند. محصول فارسی است ⇒ با ≥۲۰٪ واژهٔ
    فارسی، rtl. بدون هیچ حرف جهتدار ⇒ rtl (ارث از صفحه). */
export function textDir(text: string): Dir {
  const clean = text
    .replace(/`+[^`]*`+/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ');
  let r = 0;
  let l = 0;
  for (const w of clean.split(/\s+/)) {
    if (RTL_WORD.test(w)) r++;
    else if (LTR_WORD.test(w)) l++;
  }
  if (r === 0 && l === 0) return 'rtl';
  return r * 4 >= l ? 'rtl' : 'ltr';
}

/* ── درونخطی ───────────────────────────────────────────── */

// توالی لاتین: اختیاراً عددی در آغاز («5 mg»)، سپس واژههای لاتین با فاصله.
// هر واژه باید به حرف/رقم/٪/+ ختم شود تا نقطه و ویرگولِ پایان جملهٔ فارسی
// داخل <bdi> نرود (وگرنه نقطه در سمت اشتباهِ «ECG» مینشیند).
const LATIN_WORD = String.raw`[A-Za-z](?:[\w.\-/+%]*[\w%+])?`;
const LATIN_RUN = new RegExp(
  String.raw`(?:\d+(?:[.,]\d+)?\s?)?${LATIN_WORD}(?:\s+(?:${LATIN_WORD}|\d+(?:[.,]\d+)?(?:\s?${LATIN_WORD})?))*`,
  'g',
);

function withBdi(text: string, dir: Dir, key: string): ReactNode {
  if (dir !== 'rtl' || !/[A-Za-z]/.test(text)) return text;
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(LATIN_RUN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(<bdi key={`${key}b${i++}`}>{m[0]}</bdi>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

// ترتیب مهم است: کد پیش از همه تا محتوایش تفسیر نشود
const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\s][^*]*?)\*|(?<![\w\u0600-\u06FF])_([^_\s][^_]*?)_(?![\w\u0600-\u06FF])|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,،؛:!?])/g;

export function renderInline(text: string, dir: Dir, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  INLINE.lastIndex = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(<Fragment key={`${key}t${n++}`}>{withBdi(text.slice(last, at), dir, `${key}t${n}`)}</Fragment>);
    const k = `${key}m${n++}`;
    if (m[2] !== undefined) {
      out.push(
        <code key={k} className="md__code" dir="ltr">
          {m[2].trim()}
        </code>,
      );
    } else if (m[3] !== undefined || m[4] !== undefined) {
      out.push(<strong key={k}>{renderInline(m[3] ?? m[4], dir, k)}</strong>);
    } else if (m[5] !== undefined || m[6] !== undefined) {
      out.push(<em key={k}>{renderInline(m[5] ?? m[6], dir, k)}</em>);
    } else if (m[7] !== undefined) {
      const href = m[8];
      out.push(
        SAFE_URL.test(href) ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="md__link">
            {renderInline(m[7], dir, k)}
          </a>
        ) : (
          <Fragment key={k}>{renderInline(m[7], dir, k)}</Fragment>
        ),
      );
    } else if (m[9] !== undefined) {
      out.push(
        <a key={k} href={m[9]} target="_blank" rel="noopener noreferrer" className="md__link" dir="ltr">
          {m[9]}
        </a>,
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`${key}t${n++}`}>{withBdi(text.slice(last), dir, `${key}e`)}</Fragment>);
  return out;
}

/* ── بلوکها ────────────────────────────────────────────── */

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'code'; lang: string; text: string; open: boolean }
  | { t: 'quote'; lines: string[] }
  | { t: 'hr' }
  | { t: 'table'; head: string[]; align: Array<'start' | 'center' | 'end'>; rows: string[][] }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] };

interface ListItem {
  text: string;
  children: Block[];
}

const RE_FENCE = /^\s{0,3}(```+|~~~+)\s*([\w+#.-]*)\s*$/;
const RE_H = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const RE_HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const RE_QUOTE = /^\s{0,3}>\s?(.*)$/;
const RE_LI = /^(\s*)([-*+•]|\d{1,3}[.)]|[۰-۹]{1,3}[.)])\s+(.*)$/;
// GFM: هر خانهٔ جداکننده دستکم یک «-» (مدلها «:-:» هم میفرستند)
const RE_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const faDigit = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function parseList(lines: string[], i: number): [Block, number] {
  const first = RE_LI.exec(lines[i])!;
  const baseIndent = first[1].length;
  const ordered = /\d|[۰-۹]/.test(first[2]);
  const start = ordered ? Number.parseInt(faDigit(first[2]), 10) || 1 : 1;
  const items: ListItem[] = [];

  while (i < lines.length) {
    const m = RE_LI.exec(lines[i]);
    if (!m || m[1].length < baseIndent) break;
    if (m[1].length > baseIndent + 1) break; // تودرتو توسط فراخوان بالادستی
    if (/\d|[۰-۹]/.test(m[2]) !== ordered) break;
    const item: ListItem = { text: m[3], children: [] };
    i++;
    // خطوط ادامه و زیرفهرستها (تورفتگی بیشتر از سطح فعلی)
    const sub: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '') {
        const next = lines[i + 1];
        if (next !== undefined && /^\s+/.test(next) && (next.match(/^\s*/)?.[0].length ?? 0) > baseIndent) {
          sub.push('');
          i++;
          continue;
        }
        break;
      }
      const indent = l.match(/^\s*/)?.[0].length ?? 0;
      const li = RE_LI.exec(l);
      if (li && indent <= baseIndent + 1) break;
      if (!li && indent <= baseIndent && sub.length === 0) {
        // ادامهٔ تنبل پاراگراف همان آیتم
        if (RE_H.test(l) || RE_FENCE.test(l) || RE_QUOTE.test(l) || RE_HR.test(l) || l.includes('|')) break;
        item.text += ' ' + l.trim();
        i++;
        continue;
      }
      if (indent <= baseIndent && !li) break;
      sub.push(l.slice(Math.min(indent, baseIndent + 2)));
      i++;
    }
    if (sub.length) item.children = parseBlocks(sub.join('\n'));
    items.push(item);
  }
  return [{ t: 'list', ordered, start, items }, i];
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: 'p', text: para.join('\n') });
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    const fence = RE_FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1];
      const body: string[] = [];
      i++;
      let open = true;
      while (i < lines.length) {
        if (lines[i].trim().startsWith(marker[0].repeat(marker.length))) {
          open = false;
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      out.push({ t: 'code', lang: fence[2] || '', text: body.join('\n'), open });
      continue;
    }

    if (line.trim() === '') {
      flush();
      i++;
      continue;
    }

    const h = RE_H.exec(line);
    if (h) {
      flush();
      out.push({ t: 'h', level: h[1].length, text: h[2] });
      i++;
      continue;
    }

    // CommonMark: «- - -» و «***» خط افقیاند، نه آیتم فهرست
    if (RE_HR.test(line)) {
      flush();
      out.push({ t: 'hr' });
      i++;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && RE_TABLE_SEP.test(lines[i + 1])) {
      flush();
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'end' : 'start',
      ) as Array<'start' | 'center' | 'end'>;
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push({ t: 'table', head, align, rows });
      continue;
    }

    const q = RE_QUOTE.exec(line);
    if (q) {
      flush();
      const ql: string[] = [];
      while (i < lines.length) {
        const m = RE_QUOTE.exec(lines[i]);
        if (!m) break;
        ql.push(m[1]);
        i++;
      }
      out.push({ t: 'quote', lines: ql });
      continue;
    }

    if (RE_LI.test(line)) {
      flush();
      const [list, next] = parseList(lines, i);
      out.push(list);
      i = next;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flush();
  return out;
}

/* ── رندر ──────────────────────────────────────────────── */

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'md__clip';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className="md__pre" dir="ltr">
      <figcaption className="md__pre-head">
        <span className="md__pre-lang">{lang || 'code'}</span>
        <button
          type="button"
          className="md__pre-copy"
          onClick={async () => {
            if (await copyText(text)) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }
          }}
          aria-label="کپی کد"
        >
          <Icon name={copied ? 'i-check' : 'i-copy'} size={14} />
          <span dir="rtl">{copied ? 'کپی شد' : 'کپی'}</span>
        </button>
      </figcaption>
      <pre>
        <code>{text}</code>
      </pre>
    </figure>
  );
}

function blockText(b: Block): string {
  switch (b.t) {
    case 'p':
    case 'h':
      return b.text;
    case 'quote':
      return b.lines.join(' ');
    case 'list':
      return b.items.map((x) => x.text).join(' ');
    case 'table':
      return [...b.head, ...b.rows.flat()].join(' ');
    default:
      return '';
  }
}

function renderBlocks(blocks: Block[], key: string): ReactNode[] {
  return blocks.map((b, idx) => {
    const k = `${key}-${idx}`;
    const dir = textDir(blockText(b));
    switch (b.t) {
      case 'h': {
        const Tag = (`h${Math.min(6, b.level + 2)}` as unknown) as 'h3';
        return (
          <Tag key={k} className={`md__h md__h${b.level}`} dir={dir}>
            {renderInline(b.text, dir, k)}
          </Tag>
        );
      }
      case 'p':
        return (
          <p key={k} className="md__p" dir={dir}>
            {b.text.split('\n').map((ln, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(ln, dir, `${k}l${j}`)}
              </Fragment>
            ))}
          </p>
        );
      case 'code':
        return <CodeBlock key={k} lang={b.lang} text={b.text} />;
      case 'hr':
        return <hr key={k} className="md__hr" />;
      case 'quote':
        return (
          <blockquote key={k} className="md__quote" dir={dir}>
            {renderBlocks(parseBlocks(b.lines.join('\n')), k)}
          </blockquote>
        );
      case 'list': {
        const items = b.items.map((it, j) => {
          const idir = textDir(it.text);
          return (
            <li key={j} dir={idir}>
              {renderInline(it.text, idir, `${k}i${j}`)}
              {it.children.length > 0 && renderBlocks(it.children, `${k}c${j}`)}
            </li>
          );
        });
        return b.ordered ? (
          <ol key={k} className="md__list" dir={dir} start={b.start}>
            {items}
          </ol>
        ) : (
          <ul key={k} className="md__list" dir={dir}>
            {items}
          </ul>
        );
      }
      case 'table':
        return (
          <div key={k} className="md__table" dir={dir} role="region" aria-label="جدول" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} className={`md__a-${b.align[j] || 'start'}`}>
                      {renderInline(c, textDir(c), `${k}h${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {b.head.map((_, j) => (
                      <td key={j} className={`md__a-${b.align[j] || 'start'}`}>
                        {renderInline(row[j] ?? '', textDir(row[j] ?? ''), `${k}r${r}c${j}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

/** مارکداون → عناصر React. هنگام استریم، بلوک کدِ بسته‌نشده هم رندر می‌شود. */
export function Markdown({ text }: { text: string }) {
  return <div className="md">{renderBlocks(parseBlocks(text), 'b')}</div>;
}
