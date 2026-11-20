import type { Signature } from './sign';
/** srt, WebVTT, then simplified (text, times, italics, top / bottom): SBV, ASS / SSA, TTML / IMSC. */
export type SubtitleFormat = 'srt' | 'vtt' | 'sbv' | 'ass' | 'ttml';

/** A marker in the film. `slot` is its number (keys 1–9), fixed for its life. */
export interface Bookmark {
  id: string;
  slot: number;
  /** ms */
  time: number;
  label: string;
  /** Small picture of the frame (JPEG data URL), taken when the bookmark was added with a video. */
  image?: string;
}

export interface Cue {
  /** Stable id, never the index. */
  id: string;
  /** Start time in ms. */
  start: number;
  /** End time in ms. */
  end: number;
  /** Source text. Lines separated by "\n". Style / position tags are kept as-is. */
  text: string;
  /** Translation (translation mode only). */
  target?: string;
  /** VTT cue identifier, kept for round-trips. */
  vttId?: string;
  /** VTT cue settings string (e.g. "line:10% align:center"), kept for round-trips. */
  vttSettings?: string;
}

export interface SubtitleDoc {
  format: SubtitleFormat;
  cues: Cue[];
  /** Language of the subtitles (from the file name, or set by "Keep only <language>"). Used for the export name. */
  lang?: string;
  /** VTT only: header line after "WEBVTT" and NOTE / STYLE / REGION blocks, kept verbatim. */
  vttHeader?: string;
  vttBlocks?: string[];
}

export type IssueKind = 'overlap' | 'cps' | 'lineLength' | 'tooManyLines' | 'tooShort' | 'tooLong' | 'hi';

export interface Settings {
  minDurationMs: number;
  cpsBasedMinDuration: boolean;
  minGapMs: number;
  floorDurationMs: number;
  nudgeStepMs: number;
  snapping: boolean;
  maxCps: number;
  maxLineLength: number;
  autoPlayOnJump: boolean;
  /** A click on the video plays / pauses it. */
  clickToPlay: boolean;
  exportFormat: 'same' | SubtitleFormat;
  exportBom: boolean;
  /** Show issue warnings in the list and the timeline. */
  showIssues: boolean;
  /** Issue kinds that are not checked at all. */
  hiddenIssueKinds: IssueKind[];
  /** Check quality: the convention last chosen, and whether it's a children's programme. */
  /** Spotting: pause after each line to type its text (Enter plays on). Off: spot a whole scene first. */
  spotTypeNow: boolean;
  /** Export window: mention the quality problems left (Check quality), with a link to the report. */
  qualityOnExport: boolean;
  /** A sound when a long job starts and when it's done (store/sounds.ts). */
  sounds: boolean;
  /** Pro mode: the expert tools show (subtitle colours). Lite: kept and shown, not offered. */
  proMode: boolean;
  /** Sign the subtitles: the lines kept for the next files (lib/sign.ts). */
  signatures: Signature[];
  /** Where tool side panels dock (Check quality, Review with AI…). */
  panelSide: 'right' | 'left';
  qualityProfile: string;
  qualityChildren: boolean;
  /** Audio waveform behind the timeline blocks. */
  showWaveform: boolean;
  /** Strip of video thumbnails above the timeline track. */
  showFilmstrip: boolean;
  /** Engine for automatic translation (see src/mt). */
  translationEngine: 'chrome' | 'ai' | 'local';
  /** AI service for the 'ai' engine; keys and models are kept per provider (keys stay in this browser). */
  aiProvider: CloudProvider;
  aiKeys: Record<AiProvider, string>;
  aiModels: Record<AiProvider, string>;
  /** Local server speaking the OpenAI API (Ollama, LM Studio). */
  aiBaseUrl: string;
}

/** AI services used with the user's own key. All but Claude speak the OpenAI API (src/mt/openai.ts). */
export type CloudProvider = 'anthropic' | 'openai' | 'deepseek' | 'mistral' | 'gemini';
export const CLOUD_PROVIDERS: CloudProvider[] = ['anthropic', 'openai', 'deepseek', 'mistral', 'gemini'];
export type AiProvider = CloudProvider | 'local';

/** The provider the AI engines use: the local server for 'local', else the chosen service. */
export const activeAiProvider = (s: Pick<Settings, 'translationEngine' | 'aiProvider'>): AiProvider =>
  s.translationEngine === 'local' ? 'local' : s.aiProvider;

export const DEFAULT_SETTINGS: Settings = {
  minDurationMs: 1000,
  cpsBasedMinDuration: true,
  minGapMs: 80,
  floorDurationMs: 300,
  nudgeStepMs: 100,
  snapping: true,
  maxCps: 17,
  maxLineLength: 42,
  autoPlayOnJump: false,
  clickToPlay: true,
  exportFormat: 'same',
  exportBom: false,
  showIssues: true,
  hiddenIssueKinds: [],
  spotTypeNow: true,
  qualityOnExport: true,
  sounds: true,
  proMode: false,
  panelSide: 'right',
  signatures: [],
  qualityProfile: 'mine',
  qualityChildren: false,
  showWaveform: true,
  showFilmstrip: true,
  translationEngine: 'chrome',
  aiProvider: 'anthropic',
  aiKeys: { anthropic: '', openai: '', deepseek: '', mistral: '', gemini: '', local: '' },
  aiModels: {
    anthropic: 'claude-opus-5-5',
    openai: 'gpt-5-mini',
    deepseek: 'deepseek-chat',
    mistral: 'mistral-large-latest',
    gemini: 'gemini-flash-latest',
    local: '',
  },
  aiBaseUrl: 'http://localhost:11434/v1',
};

let counter = 0;
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  counter += 1;
  return `cue-${Date.now().toString(36)}-${counter}`;
}
