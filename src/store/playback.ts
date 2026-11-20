import { create } from 'zustand';

/**
 * Playback state lives apart from the document store: it changes every frame.
 * The <video> element registers itself here; everything else seeks through it.
 */
interface PlaybackState {
  time: number; // ms
  duration: number; // ms
  playing: boolean;
  rate: number;
  /** Set when the user scrolls a view by hand; cleared by "Back to current". */
  followPaused: boolean;
  setTime: (t: number) => void;
  setDuration: (d: number) => void;
  setPlaying: (p: boolean) => void;
  setRate: (r: number) => void;
  setFollowPaused: (p: boolean) => void;
}

export const usePlayback = create<PlaybackState>((set) => ({
  time: 0,
  duration: 0,
  playing: false,
  rate: 1,
  followPaused: false,
  setTime: (time) => set({ time }),
  setDuration: (duration) => set({ duration }),
  setPlaying: (playing) => set({ playing }),
  setRate: (rate) => set({ rate }),
  setFollowPaused: (followPaused) => set({ followPaused }),
}));

let videoEl: HTMLVideoElement | null = null;

export const player = {
  attach(el: HTMLVideoElement | null) {
    videoEl = el;
  },
  get el() {
    return videoEl;
  },
  seek(ms: number) {
    // Never past the end of the film (a subtitle can start after it): the video stops there anyway.
    const end = usePlayback.getState().duration;
    const t = Math.max(0, end > 0 ? Math.min(ms, end) : ms);
    if (videoEl) videoEl.currentTime = t / 1000;
    usePlayback.getState().setTime(t);
  },
  play() {
    videoEl?.play().catch(() => {});
  },
  pause() {
    videoEl?.pause();
  },
  toggle() {
    if (!videoEl) return;
    if (videoEl.paused) videoEl.play().catch(() => {});
    else videoEl.pause();
  },
  /** Current time, read straight from the element when there is one (more precise than the store). */
  now(): number {
    return videoEl ? videoEl.currentTime * 1000 : usePlayback.getState().time;
  },
};
