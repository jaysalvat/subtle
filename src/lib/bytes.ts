/** Sizes shown to the person: "640 KB", "4.2 MB", "1.5 GB". */
export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

/** From this size a stored thing is worth noticing (shown in red: e.g. speech recognition models). */
export const HEAVY_BYTES = 100 * 1024 * 1024;
