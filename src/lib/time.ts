import { decimal } from './locale';

const TS_RE = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/;

/** Parse "01:02:03,456", "01:02:03.456", "02:03.456" (VTT short form) into ms. Returns NaN if invalid. */
export function parseTimestamp(raw: string): number {
  const m = TS_RE.exec(raw.trim());
  if (!m) return NaN;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const s = Number(m[3]);
  const frac = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return ((h * 60 + min) * 60 + s) * 1000 + frac;
}

/**
 * Lenient time typed by a person: "1:23:45", "1:23:45.5", "83:12" (min:s, minutes can exceed 59),
 * "45" or "45.2" (seconds), "01:23:45,500". Returns NaN if it can't be read.
 */
export function parseUserTime(raw: string): number {
  const m = /^(?:(\d+):)?(?:(\d+):)?(\d+)(?:[.,](\d{1,3}))?$/.exec(raw.trim());
  if (!m) return NaN;
  const parts = [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
  const [h, min, s] = parts.length === 3 ? parts : parts.length === 2 ? [0, ...parts] : [0, 0, parts[0]];
  if (parts.length > 1 && s >= 60) return NaN;
  if (parts.length === 3 && min >= 60) return NaN;
  const frac = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return ((h * 60 + min) * 60 + s) * 1000 + frac;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

function split(ms: number) {
  const t = Math.max(0, Math.round(ms));
  return {
    h: Math.floor(t / 3_600_000),
    m: Math.floor((t % 3_600_000) / 60_000),
    s: Math.floor((t % 60_000) / 1000),
    ms: t % 1000,
  };
}

/** "00:01:02,345" */
export function formatSrtTime(ms: number): string {
  const p = split(ms);
  return `${pad(p.h)}:${pad(p.m)}:${pad(p.s)},${pad(p.ms, 3)}`;
}

/** "00:01:02.345" — used for VTT and for display. */
export function formatTimecode(ms: number): string {
  const p = split(ms);
  return `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}.${pad(p.ms, 3)}`;
}

/** Short display for ruler labels: "01:02" or "1:01:02". */
export function formatShort(ms: number): string {
  const p = split(ms);
  return p.h > 0 ? `${p.h}:${pad(p.m)}:${pad(p.s)}` : `${pad(p.m)}:${pad(p.s)}`;
}

/** A film's length as players show it: "2:52:35", "24:10", "0:58". */
export function formatLength(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** "2.4 s" */
export function formatDuration(ms: number): string {
  return `${decimal(ms / 1000, 1)} s`;
}

/**
 * Time left for a long job, from its pace so far: null until some of it is done (no guess from
 * nothing). `done` and `total` in any unit (subtitles, ms of audio…).
 */
export function timeLeft(startedAt: number, now: number, done: number, total: number): number | null {
  if (done <= 0 || total <= 0 || done >= total) return null;
  return ((now - startedAt) / done) * (total - done);
}

/** A time left, roughly: "45 s", "3 min", "1 h 20 min". */
export function formatLeft(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
