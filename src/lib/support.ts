/**
 * What this browser can do for Subtle, tested on the features themselves (never on its name):
 * Chrome and Edge have everything; Firefox and Safari miss some, depending on their version.
 */

export type Feature = 'codecs' | 'files' | 'gpu' | 'install';

/** What the page sees (globalThis, navigator…): only presence is checked. */
export interface Capabilities {
  videoDecoder: boolean;
  audioDecoder: boolean;
  saveFilePicker: boolean;
  gpu: boolean;
  /** Chromium's install / open-with support (launchQueue comes with it). */
  launchQueue: boolean;
}

/** The features this browser lacks, most important first. */
export function missingFeatures(c: Capabilities): Feature[] {
  const out: Feature[] = [];
  if (!c.videoDecoder || !c.audioDecoder) out.push('codecs');
  if (!c.saveFilePicker) out.push('files');
  if (!c.gpu) out.push('gpu');
  if (!c.launchQueue) out.push('install');
  return out;
}

/** The capabilities of the page it runs in. */
export function capabilitiesHere(g: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): Capabilities {
  const nav = (g.navigator ?? {}) as Record<string, unknown>;
  return {
    videoDecoder: typeof g.VideoDecoder === 'function',
    audioDecoder: typeof g.AudioDecoder === 'function',
    saveFilePicker: typeof g.showSaveFilePicker === 'function',
    gpu: !!nav.gpu,
    launchQueue: 'launchQueue' in g,
  };
}

/** Worth a banner: something the work depends on (not just speed or installing). */
export const worthTelling = (missing: Feature[]) => missing.includes('codecs') || missing.includes('files');
