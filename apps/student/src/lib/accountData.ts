/* Account data shared by the account screen and the app warm-up.
   Every piece goes through the SWR cache, so the account screen's first frame
   already carries the gender, intake, prestige and donation rows it ends with
   instead of popping them in one by one as the requests land. */
import { peek, put } from './swr';
import {
  profileApi,
  type IntakeItem,
  type PrestigeState,
  type ProfileUser,
  type ReferralMine,
} from './profile';

export interface AccountData {
  profile: ProfileUser | null;
  prestige: PrestigeState | null;
  referral: ReferralMine | null;
  donation: { enabled: boolean; link: string } | null;
  intakes: IntakeItem[];
}

const KEY = 'me:account';
let inflight: Promise<AccountData> | null = null;

export function peekAccount(): AccountData | undefined {
  return peek<AccountData>(KEY);
}

/** Fetches everything at once; a failed part keeps its last cached value. */
export function loadAccount(): Promise<AccountData> {
  if (inflight) return inflight;
  inflight = (async () => {
    const prev = peekAccount();
    const [p, pr, r, d, i] = await Promise.allSettled([
      profileApi.get(),
      profileApi.prestige(),
      profileApi.referral(),
      profileApi.donation(),
      profileApi.intakes(),
    ]);
    const next: AccountData = {
      profile: p.status === 'fulfilled' ? p.value?.user ?? null : prev?.profile ?? null,
      prestige: pr.status === 'fulfilled' ? pr.value?.prestige ?? null : prev?.prestige ?? null,
      referral: r.status === 'fulfilled' ? r.value ?? null : prev?.referral ?? null,
      donation: d.status === 'fulfilled' ? d.value ?? null : prev?.donation ?? null,
      intakes: i.status === 'fulfilled' ? i.value?.intakes ?? [] : prev?.intakes ?? [],
    };
    return put(KEY, next);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
