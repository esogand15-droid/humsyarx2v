/** Voice notes pinned to a spot on a handout page (or on a page the student inserted). */
import { apiCall } from './api';
import type { Scope } from './ink';

export interface VoiceNote {
  voice_id: string;
  /** Handout id, or `<id>~p` for pages the student inserted. */
  file_id: string;
  page: number;
  /** Pin position, normalised to the page (0..1). */
  x: number;
  y: number;
  duration_ms: number;
  mime: string;
  created_at: string;
}

const listPath = (scope: Scope, id: string) => `/ink/voice/${scope}/${encodeURIComponent(id)}`;
const itemPath = (voiceId: string) => `/ink/voice-item/${encodeURIComponent(voiceId)}`;

function extFor(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return '.m4a';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('mpeg')) return '.mp3';
  return '.webm';
}

export const voiceNotes = {
  list: (scope: Scope, id: string) =>
    apiCall<{ items?: VoiceNote[] }>(listPath(scope, id)).then((r) => r?.items ?? []),

  upload: (scope: Scope, id: string, page: number, x: number, y: number, durationMs: number, blob: Blob) => {
    const fd = new FormData();
    fd.append('file', blob, `voice${extFor(blob.type)}`);
    fd.append('x', String(x));
    fd.append('y', String(y));
    fd.append('duration_ms', String(Math.round(durationMs)));
    return apiCall<{ item: VoiceNote }>(`${listPath(scope, id)}/${page}`, { method: 'POST', body: fd }).then(
      (r) => r.item,
    );
  },

  move: (voiceId: string, x: number, y: number) =>
    apiCall<{ ok: boolean }>(itemPath(voiceId), { method: 'PATCH', body: JSON.stringify({ x, y }) }),

  remove: (voiceId: string) => apiCall<{ ok: boolean }>(itemPath(voiceId), { method: 'DELETE' }),

  /** Fetched with fetch() into a blob URL: Safari won't stream media without byte-range support. */
  audioUrl: (voiceId: string) => `/api/web${itemPath(voiceId)}/audio`,
};
