import { useEffect, useRef } from 'react';
import { useApp } from '../store/store';
import { useWaveform } from '../store/waveform';

/**
 * Audio waveform drawn behind the timeline blocks, for the visible time range.
 * Only speech is drawn (non-speech is skipped), scaled on speech peaks: the dialogue waveform.
 * Nothing is drawn while the audio is read (progress in the timeline header); the plain waveform
 * only if the voice detector failed.
 */
/** Bar spacing and width, px. */
const BAR_STEP = 5;
const BAR_WIDTH = 3;

/** `always`: drawn even when the timeline's waveform is switched off (a tool that needs it). */
export function WaveformCanvas({ viewStart, pps, width, always = false }: { viewStart: number; pps: number; width: number; always?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const plain = useWaveform((s) => (s.status === 'ready' ? s.waveform : null));
  const dialogue = useWaveform((s) => s.dialogue);
  const show = useApp((s) => s.settings.showWaveform) || always;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const h = c.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, h);
    const mask = dialogue?.mask ?? null;
    const waveform = mask ? dialogue!.waveform : plain;
    if (!waveform || !show) return;
    const { min, max, bucketsPerSecond: bps } = waveform;
    const mid = h / 2;
    const half = h / 2 - 3;
    ctx.fillStyle = getComputedStyle(c).getPropertyValue('--waveform').trim();
    // Bars on a fixed grid in film time (they don't shimmer while scrolling): what matters is where
    // speech starts and ends and its rise and fall, not every detail.
    const perBar = (BAR_STEP / pps) * bps; // buckets per bar
    const absX = (viewStart / 1000) * pps;
    for (let k = Math.floor(absX / BAR_STEP); ; k++) {
      const x = k * BAR_STEP - absX;
      if (x > width) break;
      const a = Math.max(0, Math.floor(k * perBar));
      const b = Math.min(min.length, Math.max(a + 1, Math.floor((k + 1) * perBar)));
      if (a >= min.length) break;
      let peak = 0;
      let sum = 0;
      let speech = 0;
      for (let i = a; i < b; i++) {
        const v = Math.max(-min[i], max[i]);
        if (v > peak) peak = v;
        sum += v;
        if (!mask || mask[i]) speech++;
      }
      // Mostly silence (or not speech): no bar.
      if (speech < (b - a) * 0.3 || peak === 0) continue;
      const amp = (0.6 * peak + (0.4 * sum) / (b - a)) / 127;
      const bh = Math.max(BAR_WIDTH, Math.min(1, amp) * half);
      ctx.beginPath();
      ctx.roundRect(x + (BAR_STEP - BAR_WIDTH) / 2, mid - bh, BAR_WIDTH, bh * 2, BAR_WIDTH / 2);
      ctx.fill();
    }
  }, [plain, dialogue, show, viewStart, pps, width]);

  return <canvas ref={ref} className="waveform" aria-hidden="true" />;
}
