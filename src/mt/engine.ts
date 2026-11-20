/**
 * Translation engines. Each one says whether it can translate a language pair and opens a session.
 * Chosen in Settings (settings.translationEngine).
 */

import type { AiContext, AiItem, TokenCount } from '../lib/mtAi';
import type { Settings } from '../lib/types';

export type EngineId = 'chrome' | 'ai' | 'local';

/**
 * ready: translates now · download: needs a one-time model download · pair: this language pair isn't
 * offered · unsupported: not in this browser · noanswer: the browser didn't answer (model service missing)
 * · nokey: needs an API key in Settings
 */
export type EngineState = 'ready' | 'download' | 'pair' | 'unsupported' | 'noanswer' | 'nokey';

export interface Session {
  /** One subtitle at a time (Chrome). */
  translate?(text: string): Promise<string>;
  /** A batch with context (AI models): translations by item number. */
  translateBatch?(items: AiItem[], context: AiContext[], scenes?: string[], instruction?: string, after?: AiContext[]): Promise<Map<number, string>>;
  /** Tokens used so far, as the provider counts them (AI services). */
  usage?: TokenCount;
  close(): void;
}

export interface Engine {
  id: EngineId;
  status(source: string, target: string, settings: Settings): Promise<EngineState>;
  /** May download a model first (onDownload gets 0…1). */
  open(source: string, target: string, settings: Settings, opts: { onDownload?: (progress: number) => void; signal?: AbortSignal }): Promise<Session>;
}
