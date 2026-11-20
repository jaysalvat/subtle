/**
 * The dialogue waveform scrolling past a fixed playhead (`at`: share of the width, centred by
 * default, so a button can sit right under it): what's about to be said shows up on the right
 * before it's heard. For tools you use by ear (Sync by ear), where the
 * timeline's waveform is too far down to watch.
 */
import { useEffect, useRef, useState } from 'react';
import { usePlayback } from '../store/playback';
import { WaveformCanvas } from './Waveform';

/** Seconds shown. */
const SPAN_S = 8;

export function LiveWaveform({ at = 0.5 }: { at?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const time = usePlayback((s) => s.time);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pps = width / SPAN_S;
  return (
    <div ref={box} className="live-waveform" aria-hidden="true">
      {width > 0 && <WaveformCanvas viewStart={time - SPAN_S * at * 1000} pps={pps} width={width} always />}
      <div className="live-waveform-head" style={{ left: `${at * 100}%` }} />
    </div>
  );
}
