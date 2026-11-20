/**
 * Translation with an AI model (Claude, OpenAI…): the film is sent in batches, each with the
 * subtitles just before it as context, and the model answers in JSON. Pure parts only; the calls
 * live in src/mt/.
 */
import { languageName } from './languages';
import { mtInput } from './mt';
import type { Cue } from './types';

/** One subtitle to translate: n is its number in the batch, seconds its duration on screen. */
export interface AiItem {
  n: number;
  text: string;
  seconds: number;
  /** Number of its scene note (see the prompt's scene notes), when the scene has one. */
  scene?: number;
}

/** A subtitle shown before the batch, with its translation when there's one. */
export interface AiContext {
  text: string;
  translation?: string;
}

export const AI_BATCH = 40;
export const AI_CONTEXT = 8;
/** Subtitles after the batch sent as context, when only some are translated again (a scene, the selection). */
export const AI_CONTEXT_AFTER = 4;

/**
 * Context from the whole film around `batch` (part of it translated again): the subtitles just
 * before and just after, with their translations (fresh ones from `out`, else the ones there).
 */
export function filmContext(
  film: Cue[],
  batch: Cue[],
  out: Map<string, string>,
  before = AI_CONTEXT,
  after = AI_CONTEXT_AFTER,
): { before: AiContext[]; after: AiContext[] } {
  const ids = new Set(batch.map((c) => c.id));
  const first = film.findIndex((c) => ids.has(c.id));
  let last = -1;
  film.forEach((c, i) => ids.has(c.id) && (last = i));
  const of = (c: Cue): AiContext => {
    const tr = out.get(c.id) ?? c.target?.trim();
    return { text: mtInput(c.text), ...(tr ? { translation: tr } : {}) };
  };
  const keep = (c: Cue) => !ids.has(c.id) && !!mtInput(c.text);
  if (first < 0) return { before: [], after: [] };
  return {
    before: film.slice(0, first).filter(keep).slice(-before).map(of),
    after: film
      .slice(last + 1)
      .filter(keep)
      .slice(0, after)
      .map(of),
  };
}

/** Split the subtitles to translate into batches (cues without text are left out). */
export function aiBatches(cues: Cue[], size = AI_BATCH): Cue[][] {
  const withText = cues.filter((c) => mtInput(c.text));
  const out: Cue[][] = [];
  for (let i = 0; i < withText.length; i += size) out.push(withText.slice(i, i + size));
  return out;
}

export function aiItems(cues: Cue[], sceneOf: (number | undefined)[] = []): AiItem[] {
  return cues.map((c, i) => ({
    n: i + 1,
    text: mtInput(c.text),
    seconds: Math.round((c.end - c.start) / 100) / 10,
    ...(sceneOf[i] ? { scene: sceneOf[i] } : {}),
  }));
}

/** The rules: stable for a whole film, so it can be cached by the provider. */
export function aiSystemPrompt(source: string, target: string, maxLineLength: number, maxCps: number): string {
  const from = languageName(source, 'en');
  const to = languageName(target, 'en');
  return [
    `You are a professional subtitle translator. Translate film subtitles from ${from} (${source}) into ${to} (${target}).`,
    '',
    'Rules:',
    '- Translate the meaning, not word by word. Sentences often run across several subtitles: read them together, but keep each translation in its own subtitle, in the same order.',
    '- Keep names, forms of address (e.g. tu/vous) and tone consistent with the context given.',
    '- A subtitle with a "scene" number belongs to that scene note (the person editing wrote who is there, who speaks to whom, the tone). Use it to guess who says each line, and choose forms of address and register accordingly, the same way throughout the scene.',
    `- Each subtitle: at most 2 lines of at most ${maxLineLength} characters. Break lines with "\\n" at a natural place; one line when it fits.`,
    `- Reading speed: aim for at most ${maxCps} characters per second of the subtitle's duration. Condense when needed, as a professional subtitler would, without losing meaning.`,
    '- Lines starting with "-" are different speakers: keep each one on its own line, starting with "- ".',
    '- Keep sound descriptions in brackets (e.g. [door slams]) translated, and speaker names before a colon unchanged.',
    '- Never merge, split, skip or add subtitles. Return exactly one translation for each number.',
    '',
    'Answer with JSON only: {"subtitles":[{"n":1,"text":"…"}, …]}',
  ].join('\n');
}

const contextLines = (title: string, list: AiContext[]) => [
  title,
  ...list.map((c) => `- ${c.text}${c.translation ? `  →  ${c.translation.replace(/\n/g, ' ')}` : ''}`),
];

/** The batch, with the subtitles before it (already translated when available), and after it. */
export function aiUserPrompt(items: AiItem[], context: AiContext[], scenes: string[] = [], instruction = '', after: AiContext[] = []): string {
  const parts: string[] = [];
  if (instruction.trim()) {
    parts.push(`Instruction from the person editing, for every subtitle below (it overrides the usual choices): ${instruction.trim()}`);
    parts.push('');
  }
  if (scenes.length) {
    parts.push('Scene notes:');
    scenes.forEach((s, i) => parts.push(`${i + 1}. ${s}`));
    parts.push('');
  }
  if (context.length) parts.push(...contextLines('Context (just before, do not translate):', context), '');
  parts.push('Translate:');
  parts.push(JSON.stringify({ subtitles: items }));
  if (after.length) parts.push('', ...contextLines('Context (just after, do not translate):', after));
  return parts.join('\n');
}

/** JSON schema of the answer (for providers with structured outputs). */
export const AI_SCHEMA = {
  type: 'object',
  properties: {
    subtitles: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'integer' }, text: { type: 'string' } },
        required: ['n', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['subtitles'],
  additionalProperties: false,
} as const;

/**
 * Read the model's answer: {"subtitles":[{n,text}]} or a bare array, possibly in a code fence.
 * Returns translations by number; unknown numbers and empty texts are dropped.
 */
export function parseAiReply(reply: string, count: number): Map<number, string> {
  const out = new Map<number, string>();
  const start = reply.search(/[[{]/);
  if (start < 0) return out;
  const end = Math.max(reply.lastIndexOf('}'), reply.lastIndexOf(']'));
  let data: unknown;
  try {
    data = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return out;
  }
  const list = Array.isArray(data) ? data : (data as { subtitles?: unknown })?.subtitles;
  if (!Array.isArray(list)) return out;
  for (const it of list) {
    const n = Number((it as { n?: unknown })?.n);
    const text = (it as { text?: unknown })?.text;
    if (Number.isInteger(n) && n >= 1 && n <= count && typeof text === 'string' && text.trim()) out.set(n, text.replace(/\\n/g, '\n').trim());
  }
  return out;
}

export interface AiModel {
  id: string;
  name: string;
  /** Unix seconds, to show the newest first. */
  created: number;
}

/** Models worth offering for translation: OpenAI lists everything (audio, images…), keep chat ones; local servers list what's installed (embedding models left out). */

/** Ollama's cloud models ("…:cloud") run on Ollama's servers, not on this computer. */
export const isCloudModel = (id: string) => /[:-]cloud\b/i.test(id);
export function translationModels(provider: 'anthropic' | 'openai' | 'deepseek' | 'mistral' | 'gemini' | 'local', models: AiModel[]): AiModel[] {
  const keep =
    provider === 'gemini'
      ? // Listed as "models/gemini-…": Gemini text models only (no embedding, image, video, speech…).
        models
          .map((m) => ({ ...m, id: m.id.replace(/^models\//, ''), name: m.name.replace(/^models\//, '') }))
          .filter((m) => m.id.startsWith('gemini-') && !/embed|image|tts|audio|live|vision|robotics|computer-use/i.test(m.id))
      : provider === 'openai'
        ? models.filter((m) => /^(gpt-|o\d)/.test(m.id) && !/audio|realtime|tts|transcribe|image|search|instruct|embedding|codex|vision/.test(m.id))
        : provider === 'mistral'
          ? models.filter((m) => !/embed|moderation|ocr|voxtral|transcribe|codestral|devstral/i.test(m.id))
          : provider === 'local'
            ? models.filter((m) => !/embed/i.test(m.id))
            : models;
  return [...keep].sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
}

/** Tokens used by a request or a whole run. */
export interface TokenCount {
  input: number;
  output: number;
}

/** About this many characters per token for Latin-script text and JSON (an estimate, not a tokenizer). */
const CHARS_PER_TOKEN = 3.5;

/**
 * What translating these subtitles will roughly cost in tokens: the real prompts are built (system
 * rules sent with every batch, the batch, the context before it), the answer is assumed as long as
 * the original. Retries of skipped lines are not counted.
 */
export function estimateTokens(cues: Cue[], source: string, target: string, maxLineLength: number, maxCps: number): TokenCount & { requests: number } {
  const system = aiSystemPrompt(source, target, maxLineLength, maxCps).length;
  let input = 0;
  let output = 0;
  let context: AiContext[] = [];
  const batches = aiBatches(cues);
  for (const batch of batches) {
    const items = aiItems(batch);
    input += system + aiUserPrompt(items, context).length;
    output += JSON.stringify({ subtitles: items.map((it) => ({ n: it.n, text: it.text })) }).length;
    context = batch.slice(-AI_CONTEXT).map((c) => ({ text: mtInput(c.text), translation: mtInput(c.text) }));
  }
  return { input: Math.ceil(input / CHARS_PER_TOKEN), output: Math.ceil(output / CHARS_PER_TOKEN), requests: batches.length };
}
