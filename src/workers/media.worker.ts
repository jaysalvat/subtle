/// <reference lib="webworker" />
/**
 * The film's worker: one file for the waveform, the filmstrip and the exact frames, started once
 * for each (`new Worker(url, { name: 'waveform' | 'thumbs' | 'frames' })`). The browser downloads
 * it once (Mediabunny and the rest inside it once), and the three still run side by side: the
 * timeline's frames never wait behind the sound being read.
 */
import { onFramesMessage } from './media/frames';
import { onThumbsMessage } from './media/thumbs';
import { onWaveformMessage } from './media/waveform';

export type MediaRole = 'waveform' | 'thumbs' | 'frames';

const handlers: Record<MediaRole, (e: MessageEvent) => void> = { waveform: onWaveformMessage, thumbs: onThumbsMessage, frames: onFramesMessage };

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = handlers[scope.name as MediaRole] ?? null;
