/* ─────────────────────────────────────────────────────────────
   📱 نشست طولانی مینیاپ

   initData تلگرام فقط یک ساعت معتبر است و auth_date لحظهٔ باز شدن
   مینیاپ ثابت میماند؛ پس بعد از ۶۰ دقیقه، وسط PDF یا ویدیو، همهٔ
   درخواستها ۴۰۱ میگرفتند و کل صفحه با خطا عوض میشد.

   حالا هنگام باز شدن، initData یک بار با یک نشست ۳۰روزهٔ سروری
   (تمدید خودکار) عوض میشود و درخواستها با هدر X-App-Session میروند.
   توکن به شناسهٔ کاربر تلگرام گره خورده تا اگر روی همان گوشی با
   حساب دیگری وارد شوند، نشست قبلی استفاده نشود.
   ───────────────────────────────────────────────────────────── */
import { getInitData, getTgUser } from './telegram';

export const APP_SESSION_HEADER = 'X-App-Session';
export const EXCHANGE_PATH = '/api/web-auth/miniapp/exchange';

const KEY_PREFIX = 'hy_app_session:';

let memoryToken = '';
let inflight = null;

function storageKey() {
  const uid = getTgUser()?.id;
  return uid ? `${KEY_PREFIX}${uid}` : '';
}

function readStored() {
  const key = storageKey();
  if (!key) return '';
  try {
    return window.localStorage.getItem(key) || '';
  } catch (_) {
    /* WebView تلگرام گاهی localStorage را بیصدا رد میکند */
    return '';
  }
}

function writeStored(token) {
  const key = storageKey();
  if (!key) return;
  try {
    if (token) window.localStorage.setItem(key, token);
    else window.localStorage.removeItem(key);
  } catch (_) {
    /* فقط حافظهٔ همین نشست میماند */
  }
}

export function getAppSession() {
  if (!memoryToken) memoryToken = readStored();
  return memoryToken;
}

export function clearAppSession() {
  memoryToken = '';
  writeStored('');
}

/* initData → نشست سروری. درخواستهای همزمان فقط یک تبادل میسازند.
   `client` همان axios اصلی است (بهصورت پارامتر تا وابستگی حلقوی نسازیم). */
export function exchangeAppSession(client) {
  const initData = getInitData();
  if (!initData) return Promise.resolve('');
  if (inflight) return inflight;

  const headers = {};
  const current = getAppSession();
  if (current) headers[APP_SESSION_HEADER] = current;

  inflight = client
    .post(
      EXCHANGE_PATH,
      { init_data: initData },
      { headers, __skipAuthRetry: true, timeout: 15000 }
    )
    .then(({ data }) => {
      const token = typeof data?.session === 'string' ? data.session : '';
      memoryToken = token;
      writeStored(token);
      return token;
    })
    .catch(() => '')
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
