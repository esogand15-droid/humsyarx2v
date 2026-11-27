import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppBar, Toast } from '../../components';
import { DsBadge, DsButton, DsCard, DsSkeleton } from '../../design/components';
import { Icon } from '../../icons/Icon';
import { ai } from '../../lib/ai';
import { faNum } from '../../lib/fa';
import './ai-studio.css';

/* پردازشگر ترد بلادرنگ AudioWorklet برای تماس صوتی بدون کلیک و ضد اکوی اسپیکر */
const HUMSYAR_LIVE_WORKLET_CODE = `
class HumsyarLiveAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate || 48000;
    this.sr = sr;
    this.cap = Math.max(48000 * 30, Math.floor(sr * 45));
    this.ring = new Float32Array(this.cap);
    this.readPos = 0;
    this.writePos = 0;
    this.avail = 0;

    this.hasHist = false;
    this.sm2 = 0;
    this.sm1 = 0;
    this.s0 = 0;
    this.resamplePhase = 0;

    this.playing = false;
    this.prebuffering = true;
    this.turnComplete = false;
    this.targetPrebufSec = 0.115;
    this.firstBufTime = 0;
    this.lastOut = 0;
    this.fadeInTotal = Math.max(32, Math.floor(sr * 0.003));
    this.fadeInRem = 0;
    this.fadeStartSample = 0;
    this.clearFadeRem = 0;
    this.clearFadeTotal = Math.max(64, Math.floor(sr * 0.004));
    this.duckGain = 1.0;
    this.speakerMuted = false;

    this.micMuted = false;
    this.hpPrevX = 0;
    this.hpPrevY = 0;
    this.hpAlpha = Math.exp((-2 * Math.PI * 25) / sr);
    this.decimRatio = sr / 16000;
    this.decimAcc = 0;
    this.decimSum = 0;
    this.decimCount = 0;
    this.micOut = new Int16Array(640);
    this.micIdx = 0;
    this.micVoiceFrames = 0;
    this.echoTailSamples = 0;

    this.telemetrySamples = 0;
    this.micSqSum = 0;
    this.micSqCnt = 0;
    this.aiSqSum = 0;
    this.aiSqCnt = 0;

    this.port.onmessage = (ev) => {
      const d = ev.data;
      if (!d) return;
      if (d.type === 'pcm24k' && d.buffer) {
        this._pushPcm24k(new Int16Array(d.buffer));
      } else if (d.type === 'clear') {
        this.readPos = 0;
        this.writePos = 0;
        this.avail = 0;
        this.playing = false;
        this.prebuffering = true;
        this.turnComplete = false;
        this.hasHist = false;
        this.echoTailSamples = 0;
        this.fadeStartSample = this.lastOut;
        this.clearFadeRem = this.clearFadeTotal;
      } else if (d.type === 'turn_complete') {
        this.turnComplete = true;
      } else if (d.type === 'mic_mute') {
        this.micMuted = !!d.muted;
      } else if (d.type === 'speaker_mute') {
        this.speakerMuted = !!d.muted;
      }
    };
  }

  _writeSample(v) {
    if (this.avail >= this.cap) {
      this.readPos = (this.readPos + 1) % this.cap;
      this.avail -= 1;
    }
    this.ring[this.writePos] = v;
    this.writePos = (this.writePos + 1) % this.cap;
    this.avail += 1;
  }

  _pushPcm24k(i16) {
    const n = i16.length;
    if (!n || this.speakerMuted) return;
    if (this.avail === 0) this.firstBufTime = currentTime;
    this.turnComplete = false;
    this.echoTailSamples = Math.floor(this.sr * 0.85);
    if (!this.hasHist) {
      const f0 = i16[0] / 32768.0;
      this.sm2 = f0; this.sm1 = f0; this.s0 = f0;
      this.resamplePhase = 0;
      this.hasHist = true;
    }

    if (this.sr === 48000) {
      let sm2 = this.sm2, sm1 = this.sm1, s0 = this.s0;
      for (let i = 0; i < n; i += 1) {
        const sp1 = i16[i] / 32768.0;
        let mid = (-0.0625 * sm2) + (0.5625 * sm1) + (0.5625 * s0) - (0.0625 * sp1);
        if (mid > 1.0) mid = 1.0; else if (mid < -1.0) mid = -1.0;
        this._writeSample(mid);
        this._writeSample(sp1);
        sm2 = sm1; sm1 = s0; s0 = sp1;
      }
      this.sm2 = sm2; this.sm1 = sm1; this.s0 = s0;
      return;
    }

    if (this.sr === 24000) {
      for (let i = 0; i < n; i += 1) this._writeSample(i16[i] / 32768.0);
      return;
    }

    const step = 24000 / this.sr;
    let phase = this.resamplePhase, sm2 = this.sm2, sm1 = this.sm1, s0 = this.s0;
    for (let i = 0; i < n; i += 1) {
      const sp1 = i16[i] / 32768.0;
      while (phase <= 1.0) {
        const t = phase;
        const c0 = s0;
        const c1 = 0.5 * (sp1 - sm1);
        const c2 = sm1 - 2.5 * s0 + 2.0 * sp1 - 0.5 * sm2;
        const c3 = 0.5 * (sp1 - sm2) + 1.5 * (s0 - sm1);
        let y = ((c3 * t + c2) * t + c1) * t + c0;
        if (y > 1.0) y = 1.0; else if (y < -1.0) y = -1.0;
        this._writeSample(y);
        phase += step;
      }
      phase -= 1.0;
      sm2 = sm1; sm1 = s0; s0 = sp1;
    }
    this.resamplePhase = phase; this.sm2 = sm2; this.sm1 = sm1; this.s0 = s0;
  }

  process(inputs, outputs) {
    const outChan = outputs[0] && outputs[0][0];
    const inChan = inputs[0] && inputs[0][0];
    const len = outChan ? outChan.length : 128;

    if (this.playing || this.avail > 0) {
      this.echoTailSamples = Math.floor(this.sr * 0.85);
    } else if (this.echoTailSamples > 0) {
      this.echoTailSamples = Math.max(0, this.echoTailSamples - len);
    }
    const echoGuardActive = this.playing || this.avail > 0 || this.echoTailSamples > 0;

    if (inChan && inChan.length && !this.micMuted) {
      if (echoGuardActive) {
        this.hpPrevX = 0; this.hpPrevY = 0; this.decimSum = 0; this.decimCount = 0; this.micVoiceFrames = 0;
        for (let i = 0; i < inChan.length; i += 1) {
          this.decimAcc += 1;
          if (this.decimAcc >= this.decimRatio) {
            this.decimAcc -= this.decimRatio;
            this.micOut[this.micIdx++] = 0;
            if (this.micIdx >= 640) {
              const copy = new Int16Array(this.micOut);
              this.port.postMessage({ type: 'mic_pcm16', buffer: copy.buffer }, [copy.buffer]);
              this.micIdx = 0;
            }
          }
        }
      } else {
        let prevX = this.hpPrevX, prevY = this.hpPrevY;
        const alpha = this.hpAlpha;
        let frameSq = 0;
        for (let i = 0; i < inChan.length; i += 1) {
          const x = inChan[i];
          const y = alpha * (prevY + x - prevX);
          prevX = x; prevY = y;
          frameSq += y * y;
          this.micSqSum += y * y; this.micSqCnt += 1;
          this.decimSum += y; this.decimCount += 1; this.decimAcc += 1;
          if (this.decimAcc >= this.decimRatio) {
            this.decimAcc -= this.decimRatio;
            const avg = this.decimCount > 0 ? (this.decimSum / this.decimCount) : y;
            this.decimSum = 0; this.decimCount = 0;
            const s = avg > 1.0 ? 1.0 : (avg < -1.0 ? -1.0 : avg);
            this.micOut[this.micIdx++] = s < 0 ? (s * 0x8000) : (s * 0x7fff);
            if (this.micIdx >= 640) {
              const copy = new Int16Array(this.micOut);
              this.port.postMessage({ type: 'mic_pcm16', buffer: copy.buffer }, [copy.buffer]);
              this.micIdx = 0;
            }
          }
        }
        this.hpPrevX = prevX; this.hpPrevY = prevY;
        const fRms = Math.sqrt(frameSq / inChan.length);
        this.micVoiceFrames = fRms > 0.045 ? Math.min(25, this.micVoiceFrames + 1) : Math.max(0, this.micVoiceFrames - 1);
      }
    } else {
      this.micVoiceFrames = 0;
    }

    if (outChan) {
      if (this.clearFadeRem > 0) {
        for (let i = 0; i < len; i += 1) {
          if (this.clearFadeRem > 0) {
            const prog = 1.0 - (this.clearFadeRem / this.clearFadeTotal);
            outChan[i] = this.fadeStartSample * 0.5 * (1.0 + Math.cos(Math.PI * prog));
            this.lastOut = outChan[i];
            this.clearFadeRem -= 1;
          } else {
            outChan[i] = 0; this.lastOut = 0;
          }
        }
      } else {
        if (!this.playing) {
          const targetSamples = Math.floor(this.sr * this.targetPrebufSec);
          const waited = this.avail > 0 ? (currentTime - this.firstBufTime) : 0;
          if (this.avail >= targetSamples || (this.turnComplete && this.avail > 0) || (this.avail > 0 && waited >= 0.145)) {
            this.playing = true; this.prebuffering = false;
            this.fadeStartSample = this.lastOut; this.fadeInRem = this.fadeInTotal;
          }
        }
        if (this.playing) {
          for (let i = 0; i < len; i += 1) {
            if (this.avail > 0) {
              let s = this.ring[this.readPos] * this.duckGain;
              this.readPos = (this.readPos + 1) % this.cap;
              this.avail -= 1;
              if (this.fadeInRem > 0) {
                const prog = 1.0 - (this.fadeInRem / this.fadeInTotal);
                const w = 0.5 * (1.0 - Math.cos(Math.PI * prog));
                s = this.fadeStartSample * (1.0 - w) + s * w;
                this.fadeInRem -= 1;
              }
              outChan[i] = this.speakerMuted ? 0 : s;
              this.lastOut = outChan[i];
              this.aiSqSum += outChan[i] * outChan[i]; this.aiSqCnt += 1;
            } else {
              const rem = len - i;
              const startS = this.lastOut;
              for (let k = 0; k < rem; k += 1) {
                outChan[i + k] = startS * 0.5 * (1.0 + Math.cos(Math.PI * ((k + 1) / rem)));
              }
              this.lastOut = 0; this.playing = false; this.prebuffering = true;
              if (!this.turnComplete) {
                this.targetPrebufSec = Math.min(0.220, this.targetPrebufSec + 0.025);
              } else {
                this.targetPrebufSec = Math.max(0.105, this.targetPrebufSec - 0.008);
                this.turnComplete = false; this.hasHist = false;
              }
              break;
            }
          }
        } else {
          for (let i = 0; i < len; i += 1) {
            if (Math.abs(this.lastOut) > 0.0001) {
              this.lastOut *= 0.85; outChan[i] = this.lastOut;
            } else {
              this.lastOut = 0; outChan[i] = 0;
            }
          }
        }
      }
    }

    this.telemetrySamples += len;
    if (this.telemetrySamples >= Math.floor(this.sr * 0.06)) {
      const micRms = this.micSqCnt > 0 ? Math.min(1, Math.sqrt(this.micSqSum / this.micSqCnt) * 4.2) : 0;
      const aiRms = this.aiSqCnt > 0 ? Math.min(1, Math.sqrt(this.aiSqSum / this.aiSqCnt) * 3.5) : 0;
      this.micSqSum = 0; this.micSqCnt = 0; this.aiSqSum = 0; this.aiSqCnt = 0; this.telemetrySamples = 0;
      this.port.postMessage({
        type: 'telemetry',
        micRms: micRms < 0.018 ? 0 : micRms,
        aiRms: aiRms < 0.012 ? 0 : aiRms,
        playing: this.playing,
      });
    }
    return true;
  }
}
registerProcessor('humsyar-live-audio-processor', HumsyarLiveAudioProcessor);
`;

let workletBlobUrl: string | null = null;
function getLiveWorkletBlobUrl(): string {
  if (!workletBlobUrl) {
    workletBlobUrl = URL.createObjectURL(new Blob([HUMSYAR_LIVE_WORKLET_CODE], { type: 'application/javascript' }));
  }
  return workletBlobUrl;
}

function downsampleTo16kPcm16Buffer(float32Buf: Float32Array, inputRate: number): ArrayBuffer {
  const ratio = !inputRate || inputRate === 16000 ? 1 : inputRate / 16000;
  const outLen = Math.round(float32Buf.length / ratio);
  const pcm16 = new Int16Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(float32Buf.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += float32Buf[j];
      count += 1;
    }
    const v = count > 0 ? sum / count : float32Buf[start] || 0;
    const s = Math.max(-1, Math.min(1, v));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm16.buffer;
}

function pcm16Base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const len = bin.length - (bin.length % 2);
  if (len <= 0) return new ArrayBuffer(0);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function pcm16ArrayBufferToFloat32(ab: ArrayBuffer): Float32Array {
  if (!ab || ab.byteLength < 2) return new Float32Array(0);
  const samples = new Int16Array(ab, 0, Math.floor(ab.byteLength / 2));
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = samples[i] / 32768.0;
  return out;
}

function concatFloat32Arrays(arrays: Float32Array[]): Float32Array {
  if (arrays.length === 0) return new Float32Array(0);
  if (arrays.length === 1) return arrays[0];
  let total = 0;
  for (const a of arrays) total += a.length;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) {
    merged.set(a, offset);
    offset += a.length;
  }
  return merged;
}

function prepareSmoothAudioSamples(
  samples24k: Float32Array,
  ctxSampleRate: number,
  prevSampleRef: { current: number },
  applyStartFadeIn: boolean,
): { data: Float32Array; rate: number } {
  if (!samples24k.length) return { data: new Float32Array(0), rate: 24000 };
  const prev = prevSampleRef.current || 0;
  if (ctxSampleRate === 48000) {
    const n = samples24k.length;
    const out = new Float32Array(n * 2);
    let sm2 = prev;
    let sm1 = prev;
    let s0 = samples24k[0];
    for (let i = 0; i < n; i += 1) {
      const sp1 = samples24k[i];
      let mid = -0.0625 * sm2 + 0.5625 * sm1 + 0.5625 * s0 - 0.0625 * sp1;
      if (mid > 1.0) mid = 1.0;
      else if (mid < -1.0) mid = -1.0;
      out[2 * i] = mid;
      out[2 * i + 1] = sp1;
      sm2 = sm1;
      sm1 = s0;
      s0 = sp1;
    }
    if (applyStartFadeIn) {
      const ramp = Math.min(out.length, 144);
      for (let i = 0; i < ramp; i += 1) out[i] *= 0.5 * (1 - Math.cos((Math.PI * (i + 1)) / ramp));
    }
    prevSampleRef.current = s0;
    return { data: out, rate: 48000 };
  }
  const out = new Float32Array(samples24k.length);
  out.set(samples24k);
  if (applyStartFadeIn) {
    const ramp = Math.min(out.length, 72);
    for (let i = 0; i < ramp; i += 1) out[i] *= 0.5 * (1 - Math.cos((Math.PI * (i + 1)) / ramp));
  } else if (out.length >= 4) {
    out[0] = 0.5 * (prev + out[0]);
  }
  prevSampleRef.current = out[out.length - 1] || 0;
  return { data: out, rate: 24000 };
}

function warmUpAudioContext(ctx: AudioContext) {
  if (!ctx || ctx.state === 'closed') return;
  try {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    const silent = ctx.createBuffer(1, 128, ctx.sampleRate || 48000);
    const src = ctx.createBufferSource();
    src.buffer = silent;
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* no-op */ }
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return faNum(`${mm}:${ss}`) || `${mm}:${ss}`;
}

type LiveStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';
type LiveCfg = Awaited<ReturnType<typeof ai.liveConfig>>;

export function AiLiveScreen() {
  const nav = useNavigate();
  const [liveCfg, setLiveCfg] = useState<LiveCfg | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [locked, setLocked] = useState(false);
  const [voice, setVoice] = useState('Sulafat');
  const [targetLang, setTargetLang] = useState('fa');
  const [activeModel, setActiveModel] = useState('');
  const [micMuted, setMicMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [maxSessionSec, setMaxSessionSec] = useState(300);
  const [userLiveText, setUserLiveText] = useState('');
  const [aiLiveText, setAiLiveText] = useState('');
  const [historyTurns, setHistoryTurns] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [toolNotice, setToolNotice] = useState('');
  const [textInput, setTextInput] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [aiLevel, setAiLevel] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const videoTimerRef = useRef<number | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletLoadedCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const playGainRef = useRef<GainNode | null>(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const pendingPcmQueueRef = useRef<Float32Array[]>([]);
  const pendingSamplesCountRef = useRef(0);
  const isPrebufferingRef = useRef(true);
  const flushTimerRef = useRef<number | null>(null);
  const prevSampleRef = useRef(0);
  const lastLevelTsRef = useRef(0);
  const lastLevelValRef = useRef(0);
  const micMutedRef = useRef(false);
  const speakerMutedRef = useRef(false);
  const aiTurnActiveRef = useRef(false);
  const workletPlayingRef = useRef(false);
  const echoCooldownUntilRef = useRef(0);
  const userBufRef = useRef('');
  const aiBufRef = useRef('');

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await ai.liveConfig();
      setLiveCfg(cfg);
      if (cfg.voice) setVoice((prev) => prev || cfg.voice);
      if (cfg.target_language) setTargetLang(cfg.target_language);
      if (cfg.model) setActiveModel(cfg.model);
      if (cfg.max_session_sec) setMaxSessionSec(cfg.max_session_sec);
      setLocked(false);
    } catch (err) {
      const e = err as { status?: number; message?: string; data?: { code?: string } };
      setLocked(e?.status === 402 || e?.data?.code === 'FEATURE_LOCKED');
      setErrMsg(e?.message || 'دریافت تنظیمات تماس زنده ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    micMutedRef.current = micMuted;
    workletNodeRef.current?.port.postMessage({ type: 'mic_mute', muted: micMuted });
    if (micMuted) {
      setMicLevel(0);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'audio_stream_end' }));
        } catch { /* ignore */ }
      }
    }
  }, [micMuted]);

  useEffect(() => {
    speakerMutedRef.current = speakerMuted;
    workletNodeRef.current?.port.postMessage({ type: 'speaker_mute', muted: speakerMuted });
  }, [speakerMuted]);

  const stopAllPlayback = useCallback(() => {
    aiTurnActiveRef.current = false;
    workletPlayingRef.current = false;
    echoCooldownUntilRef.current = 0;
    try {
      workletNodeRef.current?.port.postMessage({ type: 'clear' });
    } catch { /* ignore */ }
    setAiLevel(0);
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingPcmQueueRef.current = [];
    pendingSamplesCountRef.current = 0;
    isPrebufferingRef.current = true;
    prevSampleRef.current = 0;

    const ctx = playCtxRef.current;
    const gainNode = playGainRef.current;
    if (ctx && gainNode && ctx.state === 'running') {
      try {
        const now = ctx.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.012);
        gainNode.gain.setValueAtTime(1.0, now + 0.016);
      } catch { /* ignore */ }
    }
    for (const src of activeSourcesRef.current) {
      try { src.stop(); } catch { /* ignore */ }
    }
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
  }, []);

  const stopCameraStream = useCallback(() => {
    if (videoTimerRef.current) {
      window.clearInterval(videoTimerRef.current);
      videoTimerRef.current = null;
    }
    if (videoStreamRef.current) {
      for (const tr of videoStreamRef.current.getTracks()) {
        try { tr.stop(); } catch { /* ignore */ }
      }
      videoStreamRef.current = null;
    }
    if (videoElRef.current) videoElRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  const startCameraStream = useCallback(async (mode: 'user' | 'environment' = facingMode) => {
    stopCameraStream();
    try {
      const vStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      videoStreamRef.current = vStream;
      setCameraOn(true);
      setFacingMode(mode);
      if (videoElRef.current) {
        videoElRef.current.srcObject = vStream;
        void videoElRef.current.play().catch(() => {});
      }
      const canvas = document.createElement('canvas');
      const ctx2d = canvas.getContext('2d');
      videoTimerRef.current = window.setInterval(() => {
        const vid = videoElRef.current;
        if (!vid || !ctx2d || wsRef.current?.readyState !== WebSocket.OPEN) return;
        if (!vid.videoWidth || !vid.videoHeight) return;
        const scale = Math.min(1, 640 / Math.max(vid.videoWidth, vid.videoHeight));
        canvas.width = Math.round(vid.videoWidth * scale);
        canvas.height = Math.round(vid.videoHeight * scale);
        ctx2d.drawImage(vid, 0, 0, canvas.width, canvas.height);
        const b64 = canvas.toDataURL('image/jpeg', 0.65).split(',')[1] || '';
        if (b64) {
          wsRef.current.send(JSON.stringify({ type: 'video', data: b64, mimeType: 'image/jpeg' }));
        }
      }, 1000);
    } catch {
      setErrMsg('دسترسی به دوربین داده نشد؛ لطفاً مجوز دوربین را در مرورگر فعال کنید.');
    }
  }, [facingMode, stopCameraStream]);

  useEffect(() => {
    if (cameraOn && videoElRef.current && videoStreamRef.current) {
      videoElRef.current.srcObject = videoStreamRef.current;
      void videoElRef.current.play().catch(() => {});
    }
  }, [cameraOn]);

  const ensurePlaybackContext = useCallback(() => {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!playCtxRef.current || playCtxRef.current.state === 'closed') {
      try {
        playCtxRef.current = new AC({ latencyHint: 'interactive' });
      } catch {
        playCtxRef.current = new AC();
      }
      playGainRef.current = null;
    }
    const ctx = playCtxRef.current;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    if (!playGainRef.current) {
      const gain = ctx.createGain();
      gain.gain.value = 1.0;
      gain.connect(ctx.destination);
      playGainRef.current = gain;
    }
    return ctx;
  }, []);

  const flushPendingAudio = useCallback((forceFlush = false) => {
    if (flushTimerRef.current && forceFlush) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (!pendingPcmQueueRef.current.length) return;
    if (isPrebufferingRef.current && !forceFlush && pendingSamplesCountRef.current < 3360) return;
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const merged24k = concatFloat32Arrays(pendingPcmQueueRef.current);
    pendingPcmQueueRef.current = [];
    pendingSamplesCountRef.current = 0;
    if (!merged24k.length) return;

    try {
      const ctx = ensurePlaybackContext();
      const now = ctx.currentTime;
      const wasUnderrun = !nextPlayTimeRef.current || nextPlayTimeRef.current <= now + 0.004;
      const applyFadeIn = isPrebufferingRef.current || wasUnderrun;
      isPrebufferingRef.current = false;

      const { data: smoothSamples, rate: bufRate } = prepareSmoothAudioSamples(
        merged24k,
        ctx.sampleRate,
        prevSampleRef,
        applyFadeIn,
      );
      if (!smoothSamples.length) return;

      const audioBuf = ctx.createBuffer(1, smoothSamples.length, bufRate);
      audioBuf.getChannelData(0).set(new Float32Array(smoothSamples));
      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(playGainRef.current || ctx.destination);

      const startAt = wasUnderrun ? now + 0.045 : Math.max(now + 0.008, nextPlayTimeRef.current);
      nextPlayTimeRef.current = startAt + audioBuf.duration;
      const remMs = Math.max(0, (nextPlayTimeRef.current - now) * 1000);
      echoCooldownUntilRef.current = Math.max(echoCooldownUntilRef.current, performance.now() + remMs + 850);

      activeSourcesRef.current.push(src);
      setStatus((prev) => (prev === 'speaking' ? prev : 'speaking'));
      src.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter((x) => x !== src);
        if (activeSourcesRef.current.length === 0 && pendingSamplesCountRef.current === 0) {
          isPrebufferingRef.current = true;
          prevSampleRef.current = 0;
          setStatus((prev) => (prev === 'speaking' ? 'listening' : prev));
        }
      };
      src.start(startAt);
    } catch { /* ignore */ }
  }, [ensurePlaybackContext]);

  const scheduleAudioChunk = useCallback((rawOrB64: ArrayBuffer | string) => {
    if (speakerMutedRef.current || !rawOrB64) return;
    try {
      const ab = rawOrB64 instanceof ArrayBuffer ? rawOrB64 : pcm16Base64ToArrayBuffer(rawOrB64);
      if (!ab || ab.byteLength < 2) return;
      const chunkMs = (ab.byteLength / 48000.0) * 1000;
      aiTurnActiveRef.current = true;
      echoCooldownUntilRef.current = Math.max(echoCooldownUntilRef.current, performance.now()) + chunkMs + 850;

      if (workletNodeRef.current) {
        workletNodeRef.current.port.postMessage({ type: 'pcm24k', buffer: ab }, [ab]);
        setStatus((prev) => (prev === 'speaking' ? prev : 'speaking'));
        return;
      }

      const float32 = pcm16ArrayBufferToFloat32(ab);
      if (!float32.length) return;
      const ctx = ensurePlaybackContext();
      if (!nextPlayTimeRef.current || nextPlayTimeRef.current <= ctx.currentTime + 0.004) {
        isPrebufferingRef.current = true;
      }
      pendingPcmQueueRef.current.push(float32);
      pendingSamplesCountRef.current += float32.length;
      if (isPrebufferingRef.current) {
        if (pendingSamplesCountRef.current >= 3360) flushPendingAudio(true);
        else if (!flushTimerRef.current) {
          flushTimerRef.current = window.setTimeout(() => {
            flushTimerRef.current = null;
            flushPendingAudio(true);
          }, 110);
        }
      } else {
        flushPendingAudio(true);
      }
    } catch { /* ignore */ }
  }, [ensurePlaybackContext, flushPendingAudio]);

  const cleanupSession = useCallback(() => {
    stopAllPlayback();
    stopCameraStream();
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.port.onmessage = null;
        workletNodeRef.current.disconnect();
      } catch { /* ignore */ }
      workletNodeRef.current = null;
    }
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch { /* ignore */ }
      processorRef.current = null;
    }
    if (captureCtxRef.current && captureCtxRef.current !== playCtxRef.current) {
      try { void captureCtxRef.current.close(); } catch { /* ignore */ }
    }
    captureCtxRef.current = null;
    if (mediaStreamRef.current) {
      for (const tr of mediaStreamRef.current.getTracks()) {
        try { tr.stop(); } catch { /* ignore */ }
      }
      mediaStreamRef.current = null;
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }
    setMicLevel(0);
    setAiLevel(0);
  }, [stopAllPlayback, stopCameraStream]);

  useEffect(() => () => cleanupSession(), [cleanupSession]);

  useEffect(() => {
    if (status === 'idle' || status === 'connecting' || status === 'error') return undefined;
    const id = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  async function startCall(withVideo = false) {
    setErrMsg('');
    setLocked(false);
    setToolNotice('');
    setUserLiveText('');
    setAiLiveText('');
    userBufRef.current = '';
    aiBufRef.current = '';
    setElapsedSec(0);

    try {
      warmUpAudioContext(ensurePlaybackContext());
    } catch { /* ignore */ }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      setStatus('error');
      setErrMsg('دسترسی به میکروفون داده نشد؛ لطفاً مجوز میکروفون را در مرورگر فعال کنید.');
      return;
    }

    try {
      warmUpAudioContext(ensurePlaybackContext());
    } catch { /* ignore */ }

    mediaStreamRef.current = stream;
    setStatus('connecting');
    if (withVideo) void startCameraStream(facingMode);

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const qs = new URLSearchParams({
      voice: voice || liveCfg?.voice || 'Sulafat',
      target_language: targetLang || 'fa',
      binary: '1',
    });
    const ws = new WebSocket(`${wsProto}//${window.location.host}/api/ai/live/ws?${qs.toString()}`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = async (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        scheduleAudioChunk(ev.data);
        return;
      }
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }

      if (msg.type === 'ready') {
        setActiveModel(String(msg.model || liveCfg?.model || 'gemini-live'));
        if (typeof msg.max_session_sec === 'number') setMaxSessionSec(msg.max_session_sec);
        setStatus('listening');

        try {
          const capCtx = ensurePlaybackContext();
          captureCtxRef.current = capCtx;
          const srcNode = capCtx.createMediaStreamSource(stream);
          if (capCtx.audioWorklet && typeof window.AudioWorkletNode !== 'undefined') {
            try {
              if (workletLoadedCtxRef.current !== capCtx) {
                await capCtx.audioWorklet.addModule(getLiveWorkletBlobUrl());
                workletLoadedCtxRef.current = capCtx;
              }
              const wNode = new window.AudioWorkletNode(capCtx, 'humsyar-live-audio-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [1],
              });
              wNode.port.postMessage({ type: 'mic_mute', muted: micMutedRef.current });
              wNode.port.postMessage({ type: 'speaker_mute', muted: speakerMutedRef.current });
              wNode.port.onmessage = (wEv) => {
                const d = wEv.data as { type?: string; buffer?: ArrayBuffer; micRms?: number; aiRms?: number; playing?: boolean } | null;
                if (!d) return;
                if (d.type === 'mic_pcm16' && d.buffer) {
                  if (!micMutedRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
                    if (aiTurnActiveRef.current || workletPlayingRef.current || performance.now() < echoCooldownUntilRef.current) {
                      wsRef.current.send(new ArrayBuffer(d.buffer.byteLength));
                    } else {
                      wsRef.current.send(d.buffer);
                    }
                  }
                } else if (d.type === 'telemetry') {
                  setMicLevel(d.micRms || 0);
                  setAiLevel(d.aiRms || 0);
                  workletPlayingRef.current = !!d.playing;
                  if (d.playing) {
                    echoCooldownUntilRef.current = Math.max(echoCooldownUntilRef.current, performance.now() + 850);
                    setStatus((prev) => (prev === 'speaking' ? prev : 'speaking'));
                  } else {
                    setStatus((prev) => (prev === 'speaking' ? 'listening' : prev));
                  }
                }
              };
              srcNode.connect(wNode);
              wNode.connect(playGainRef.current || capCtx.destination);
              workletNodeRef.current = wNode;
              return;
            } catch { /* fallback to ScriptProcessor */ }
          }

          const proc = capCtx.createScriptProcessor(2048, 1, 1);
          const silentGain = capCtx.createGain();
          silentGain.gain.value = 0;
          processorRef.current = proc;
          proc.onaudioprocess = (audioEv) => {
            if (micMutedRef.current || wsRef.current?.readyState !== WebSocket.OPEN) {
              if (lastLevelValRef.current !== 0) {
                lastLevelValRef.current = 0;
                setMicLevel(0);
              }
              return;
            }
            const raw = audioEv.inputBuffer.getChannelData(0);
            const nowMs = performance.now();
            const echoBusy =
              aiTurnActiveRef.current ||
              activeSourcesRef.current.length > 0 ||
              pendingSamplesCountRef.current > 0 ||
              nowMs < echoCooldownUntilRef.current;
            if (echoBusy) {
              const outLen = Math.round(raw.length / ((capCtx.sampleRate || 48000) / 16000));
              wsRef.current.send(new ArrayBuffer(outLen * 2));
              return;
            }
            if (nowMs - lastLevelTsRef.current >= 80) {
              let sumSq = 0;
              for (let i = 0; i < raw.length; i += 8) sumSq += raw[i] * raw[i];
              const rms = Math.min(1, Math.sqrt(sumSq / (raw.length / 8)) * 4);
              lastLevelTsRef.current = nowMs;
              const nextLvl = rms < 0.02 ? 0 : rms;
              lastLevelValRef.current = nextLvl;
              setMicLevel(nextLvl);
            }
            wsRef.current.send(downsampleTo16kPcm16Buffer(raw, capCtx.sampleRate));
          };
          srcNode.connect(proc);
          proc.connect(silentGain);
          silentGain.connect(capCtx.destination);
        } catch {
          setErrMsg('راه‌اندازی میکروفون ناموفق بود.');
        }
        return;
      }

      if (msg.type === 'audio' && typeof msg.data === 'string') {
        scheduleAudioChunk(msg.data);
        return;
      }
      if (msg.type === 'interrupted') {
        stopAllPlayback();
        setStatus('listening');
        return;
      }
      if (msg.type === 'input_transcript' && typeof msg.text === 'string') {
        userBufRef.current = `${userBufRef.current} ${msg.text}`.trim();
        setUserLiveText(userBufRef.current);
        return;
      }
      if (msg.type === 'user_transcript_override' && typeof msg.text === 'string') {
        const overrideText = msg.text;
        setHistoryTurns((prev) => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i -= 1) {
            if (copy[i].role === 'user') {
              copy[i] = { ...copy[i], text: overrideText };
              return copy;
            }
          }
          return [...copy.slice(-14), { role: 'user', text: overrideText }];
        });
        return;
      }
      if ((msg.type === 'output_transcript' || msg.type === 'text') && typeof msg.text === 'string') {
        aiTurnActiveRef.current = true;
        aiBufRef.current = `${aiBufRef.current} ${msg.text}`.trim();
        setAiLiveText(aiBufRef.current);
        return;
      }
      if (msg.type === 'tool_call') {
        const calls = Array.isArray(msg.calls) ? (msg.calls as Array<{ name?: string }>) : [];
        const names = calls.map((c) => c.name || '').filter(Boolean).join('، ');
        setToolNotice(names ? `در حال بررسی اطلاعات هامزیار (${names})…` : 'در حال استعلام از هامزیار…');
        setStatus('thinking');
        return;
      }
      if (msg.type === 'turn_state') {
        if (msg.interaction_status === 'IN_PROGRESS') {
          setStatus('thinking');
        } else if (msg.interaction_status === 'IDLE' || msg.turn_complete) {
          aiTurnActiveRef.current = false;
          echoCooldownUntilRef.current = Math.max(echoCooldownUntilRef.current, performance.now() + 850);
          if (workletNodeRef.current) {
            try { workletNodeRef.current.port.postMessage({ type: 'turn_complete' }); } catch { /* ignore */ }
          } else {
            flushPendingAudio(true);
          }
          setToolNotice('');
          if (userBufRef.current || aiBufRef.current) {
            const uSnap = userBufRef.current;
            const aSnap = aiBufRef.current;
            setHistoryTurns((prev) => [
              ...prev.slice(-14),
              ...(uSnap ? [{ role: 'user' as const, text: uSnap }] : []),
              ...(aSnap ? [{ role: 'assistant' as const, text: aSnap }] : []),
            ]);
            userBufRef.current = '';
            aiBufRef.current = '';
            setUserLiveText('');
            setAiLiveText('');
          }
          if (!workletNodeRef.current && activeSourcesRef.current.length === 0 && pendingSamplesCountRef.current === 0) {
            setStatus('listening');
          }
        }
        return;
      }
      if (msg.type === 'session_limit') {
        setToast(String(msg.message || 'مدت زمان مجاز تماس به پایان رسید.'));
        cleanupSession();
        setStatus('idle');
        void loadConfig();
        return;
      }
      if (msg.type === 'error') {
        setErrMsg(String(msg.message || 'خطا در ارتباط صوتی زنده.'));
        cleanupSession();
        setStatus('error');
      }
    };

    ws.onerror = () => {
      setErrMsg('خطا در اتصال WebSocket به سرویس تماس زنده.');
      cleanupSession();
      setStatus('error');
    };

    ws.onclose = () => {
      cleanupSession();
      setStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
      void loadConfig();
    };
  }

  function interruptAiSpeech() {
    stopAllPlayback();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try { wsRef.current.send(JSON.stringify({ type: 'barge_in' })); } catch { /* ignore */ }
    }
    setStatus('listening');
  }

  function endCall() {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try { wsRef.current.send(JSON.stringify({ type: 'stop' })); } catch { /* ignore */ }
    }
    cleanupSession();
    setStatus('idle');
    void loadConfig();
  }

  function sendTextTurn() {
    const txt = textInput.trim();
    if (!txt || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'text', text: txt }));
    setHistoryTurns((prev) => [...prev.slice(-14), { role: 'user', text: txt }]);
    setTextInput('');
  }

  const isCallActive =
    status === 'connecting' || status === 'listening' || status === 'thinking' || status === 'speaking';
  const isTranslateModel = (activeModel || liveCfg?.model || '').includes('translate');

  const statusMeta = {
    idle: { label: 'آماده برقراری تماس صوتی/ویدیویی زنده', color: '#64748B' },
    connecting: { label: 'در حال اتصال به هوشیار زنده…', color: '#F59E0B' },
    listening: { label: micMuted ? 'میکروفون بی‌صداست' : 'در حال گوش دادن… صحبت کنید', color: '#10B981' },
    thinking: { label: 'هوشیار در حال استدلال…', color: '#8B5CF6' },
    speaking: { label: 'هوشیار در حال صحبت است (برای قطع نوبت روی دایره بزنید)', color: '#3B82F6' },
    error: { label: 'خطا در تماس زنده', color: '#EF4444' },
  }[status];

  const orbScale =
    status === 'speaking'
      ? 1.06 + Math.min(0.25, aiLevel * 0.42)
      : status === 'listening'
        ? 1 + Math.min(0.24, micLevel * 0.35)
        : 1;

  return (
    <div className="screen ais-page">
      <AppBar
        title="تماس صوتی و ویدیویی زنده"
        sub="گفت‌وگوی بلادرنگ با هوشیار (صوت، دوربین و زیرنویس هم‌زمان)"
        back
        onBack={() => nav('/ai')}
      />

      {loading ? (
        <DsCard className="ais-section">
          <DsSkeleton shape="card" />
        </DsCard>
      ) : (
        <div className="ais-live-stage">
          <div className="ais-head-row" style={{ justifyContent: 'center', marginBottom: 10 }}>
            <DsBadge tone="neutral">{activeModel || liveCfg?.model || 'gemini-live'}</DsBadge>
            {liveCfg?.usage && (
              <DsBadge tone={liveCfg.usage.unlimited ? 'success' : 'accent'}>
                {liveCfg.usage.unlimited
                  ? 'مصرف امروز: نامحدود'
                  : `باقی‌مانده امروز: ${formatClock(liveCfg.usage.remaining_sec ?? 0)}`}
              </DsBadge>
            )}
            {isCallActive && (
              <DsBadge tone="warning">
                {formatClock(elapsedSec)} / {formatClock(maxSessionSec)}
              </DsBadge>
            )}
          </div>

          {cameraOn && (
            <div className="ais-video-box">
              <video ref={videoElRef} autoPlay playsInline muted />
              <div style={{ position: 'absolute', bottom: 8, left: 8 }}>
                <DsButton
                  variant="secondary"
                  size="sm"
                  onClick={() => void startCameraStream(facingMode === 'environment' ? 'user' : 'environment')}
                >
                  تعویض دوربین
                </DsButton>
              </div>
            </div>
          )}

          <div
            className={`ais-orb${cameraOn ? ' ais-orb--compact' : ''}`}
            onClick={status === 'speaking' ? interruptAiSpeech : undefined}
            role={status === 'speaking' ? 'button' : undefined}
            tabIndex={status === 'speaking' ? 0 : undefined}
            onKeyDown={(e) => {
              if (status === 'speaking' && (e.key === 'Enter' || e.key === ' ')) interruptAiSpeech();
            }}
            style={{
              cursor: status === 'speaking' ? 'pointer' : 'default',
              transform: `scale(${orbScale.toFixed(3)})`,
              background: `radial-gradient(circle at 35% 35%, ${statusMeta.color}55, ${statusMeta.color}18 70%)`,
              border: `2px solid ${statusMeta.color}`,
              boxShadow: isCallActive ? `0 0 36px ${statusMeta.color}55` : 'none',
            }}
          >
            <Icon name={cameraOn ? 'i-video' : 'i-headphones'} />
          </div>

          <p className="ais-title" style={{ color: '#F8FAFC', marginBottom: 6 }}>
            {statusMeta.label}
          </p>
          {toolNotice && <p className="ais-sub" style={{ color: '#C4B5FD' }}>{toolNotice}</p>}

          {status === 'speaking' && (
            <div style={{ marginTop: 10 }}>
              <DsButton variant="secondary" size="sm" onClick={interruptAiSpeech}>
                توقف صحبت هوشیار و نوبت من
              </DsButton>
            </div>
          )}

          {errMsg && (
            <DsCard level="sunken" style={{ marginTop: 12, textAlign: 'right' }}>
              <p className="ais-sub" style={{ color: 'var(--danger)' }}>{errMsg}</p>
              {locked && (
                <div style={{ marginTop: 8 }}>
                  <Link className="btn btn--primary btn--sm" to="/subscription">
                    مشاهده اشتراک‌ها
                  </Link>
                </div>
              )}
            </DsCard>
          )}

          {!isCallActive && (
            <div className="ais-section" style={{ marginTop: 14, textAlign: 'right' }}>
              <label className="ais-sub">
                صدای هوشیار در تماس زنده
                <select
                  className="ais-select"
                  style={{ marginTop: 6 }}
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                >
                  {(liveCfg?.voices || [{ id: 'Sulafat', label: 'Sulafat — گرم' }]).map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </label>

              {isTranslateModel && (
                <label className="ais-sub">
                  زبان مقصد ترجمه صوتی
                  <select
                    className="ais-select"
                    style={{ marginTop: 6 }}
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value)}
                  >
                    {(liveCfg?.translate_languages || [{ code: 'fa', label: 'فارسی' }]).map((l) => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          <div className="ais-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
            {!isCallActive ? (
              <>
                <DsButton
                  variant="primary"
                  disabled={Boolean(liveCfg && !liveCfg.enabled)}
                  onClick={() => void startCall(false)}
                >
                  <Icon name="i-headphones" />
                  شروع تماس صوتی زنده
                </DsButton>
                {!isTranslateModel && (
                  <DsButton
                    variant="secondary"
                    disabled={Boolean(liveCfg && !liveCfg.enabled)}
                    onClick={() => void startCall(true)}
                  >
                    <Icon name="i-video" />
                    تماس ویدیویی + صوتی
                  </DsButton>
                )}
              </>
            ) : (
              <>
                <DsButton
                  variant={micMuted ? 'danger' : 'secondary'}
                  onClick={() => setMicMuted((m) => !m)}
                >
                  {micMuted ? 'میکروفون بسته' : 'میکروفون باز'}
                </DsButton>
                {!isTranslateModel && (
                  <DsButton
                    variant={cameraOn ? 'primary' : 'secondary'}
                    onClick={() => (cameraOn ? stopCameraStream() : void startCameraStream(facingMode))}
                  >
                    {cameraOn ? 'بستن دوربین' : 'روشن کردن دوربین'}
                  </DsButton>
                )}
                <DsButton
                  variant={speakerMuted ? 'danger' : 'secondary'}
                  onClick={() => {
                    const next = !speakerMuted;
                    setSpeakerMuted(next);
                    if (next) stopAllPlayback();
                  }}
                >
                  {speakerMuted ? 'بلندگو بسته' : 'بلندگو باز'}
                </DsButton>
                <DsButton variant="danger" onClick={endCall}>
                  پایان تماس
                </DsButton>
              </>
            )}
          </div>
        </div>
      )}

      {(userLiveText || aiLiveText || historyTurns.length > 0) && (
        <DsCard className="ais-section">
          <h3 className="ais-title">زیرنویس زنده مکالمه</h3>
          <div className="ais-transcript">
            {historyTurns.map((t, idx) => (
              <div key={idx} className={`ais-turn ais-turn--${t.role === 'user' ? 'user' : 'ai'}`}>
                <strong>{t.role === 'user' ? 'شما: ' : 'هوشیار: '}</strong>
                <span>{t.text}</span>
              </div>
            ))}
            {userLiveText && (
              <div className="ais-turn ais-turn--user">
                <strong>شما (زنده): </strong>
                <span>{userLiveText}</span>
              </div>
            )}
            {aiLiveText && (
              <div className="ais-turn ais-turn--ai">
                <strong>هوشیار (زنده): </strong>
                <span>{aiLiveText}</span>
              </div>
            )}
          </div>
        </DsCard>
      )}

      {isCallActive && !isTranslateModel && (
        <DsCard className="ais-actions" style={{ flexWrap: 'nowrap' }}>
          <input
            className="ais-input"
            placeholder="ارسال نکته متنی حین مکالمه…"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendTextTurn();
            }}
          />
          <DsButton variant="primary" disabled={!textInput.trim()} onClick={sendTextTurn}>
            ارسال
          </DsButton>
        </DsCard>
      )}

      <Toast message={toast} />
    </div>
  );
}
