/**
 * Shorten with AI (Check quality): subtitles still too fast after the automatic fixes get a shorter
 * version from the AI model set up for translation, accepted one by one. Pure parts: what goes in
 * the prompt, how many characters each one may keep, reading the answer.
 */
import { languageName } from './languages';
import { editableText, sameWords, withEditedText } from './markup';
import { charCount } from './tools';
import type { Cue } from './types';

export interface CondenseItem {
  n: number;
  text: string;
  /** Characters it may have to be read in time (spaces and punctuation count). */
  maxChars: number;
  /** The subtitles around it, for the sense (not to be changed). */
  before?: string;
  after?: string;
}

/** The text a check reads and a fix changes: the translation while translating, when there is one. */
export const condenseField = (c: Cue): 'text' | 'target' => (c.target !== undefined && c.target.trim() ? 'target' : 'text');

/** How many characters fit in the subtitle's time at this reading speed. */
/** Below this, shortening can't help: the subtitle needs time, not fewer words. */
export const MIN_ON_SCREEN_MS = 300;

export const maxCharsFor = (c: Cue, maxCps: number) => Math.max(1, Math.floor(((c.end - c.start) / 1000) * maxCps));

export function condenseItems(cues: Cue[], ids: string[], maxCps: number): { items: CondenseItem[]; ids: string[] } {
  const set = new Set(ids);
  const items: CondenseItem[] = [];
  const picked: string[] = [];
  cues.forEach((c, i) => {
    // Almost no time on screen: that's a timing problem (merge it, give it time), not a text one.
    if (!set.has(c.id) || c.end - c.start < MIN_ON_SCREEN_MS) return;
    const f = condenseField(c);
    const plain = (x?: Cue) => (x ? editableText(x[condenseField(x)] ?? '').replace(/\n/g, ' ') : undefined);
    items.push({
      n: items.length + 1,
      text: editableText(c[f] ?? ''),
      maxChars: maxCharsFor(c, maxCps),
      before: plain(cues[i - 1]),
      after: plain(cues[i + 1]),
    });
    picked.push(c.id);
  });
  return { items, ids: picked };
}

export function condenseSystemPrompt(lang: string | undefined, maxLineLength: number): string {
  const language = lang ? `${languageName(lang, 'en')} (${lang})` : 'the language of the text';
  return [
    `You are a professional subtitler. These film subtitles in ${language} are too long to be read in the time they are on screen. Shorten each one, in the same language.`,
    '',
    'Rules:',
    '- Keep the meaning, the tone and every name. Never add anything.',
    '- Cut what a subtitler cuts: hesitations, repetitions, fillers ("well", "you know"), redundant words; rephrase more briefly when needed.',
    '- Each text must have at most "maxChars" characters, counting spaces and punctuation.',
    `- At most 2 lines of at most ${maxLineLength} characters; break lines with "\\n" at a natural place, one line when it fits.`,
    '- Lines starting with "-" are different speakers: keep one line per speaker, starting with "- ".',
    '- "before" and "after" are the subtitles around it, for the sense only: don\'t shorten them.',
    '- Return exactly one text for each number.',
    '',
    'Answer with JSON only: {"subtitles":[{"n":1,"text":"…"}, …]}',
  ].join('\n');
}

export function condenseUserPrompt(items: CondenseItem[]): string {
  return 'Shorten:\n' + JSON.stringify({ subtitles: items });
}

/**
 * Tokens a run will roughly take (about 4 characters a token): the instructions once per batch, the
 * subtitles with their context sent, a shorter version of each received.
 */
export function estimateCondense(items: CondenseItem[], system: string, batches: number): { input: number; output: number } {
  const text = items.reduce((n, it) => n + it.text.length, 0);
  return { input: Math.round((system.length * batches + condenseUserPrompt(items).length) / 4), output: Math.round((text * 0.8) / 4 + items.length * 8) };
}

export interface Proposal {
  id: string;
  field: 'text' | 'target';
  before: string;
  after: string;
  maxChars: number;
  /** Still longer than it may be (the model couldn't, or didn't, shorten enough). */
  stillLong: boolean;
}

/** The model's texts → proposals (markup kept: position, whole-subtitle italics). Unchanged or empty ones are dropped. */
export function proposals(cues: Cue[], ids: string[], items: CondenseItem[], got: Map<number, string>): Proposal[] {
  const byId = new Map(cues.map((c) => [c.id, c]));
  const out: Proposal[] = [];
  items.forEach((it, i) => {
    const c = byId.get(ids[i]);
    const text = got.get(it.n)?.trim();
    if (!c || !text) return;
    const f = condenseField(c);
    const before = c[f] ?? '';
    const after = withEditedText(before, text);
    // The same text (spaces aside): nothing to propose.
    if (sameWords(editableText(after), editableText(before))) return;
    out.push({ id: c.id, field: f, before, after, maxChars: it.maxChars, stillLong: charCount(after) > it.maxChars });
  });
  return out;
}

/** Accepted proposals applied (one undo step for the caller). */
export function applyProposals(cues: Cue[], accepted: Proposal[]): Cue[] {
  const by = new Map(accepted.map((p) => [p.id, p]));
  return cues.map((c) => {
    const p = by.get(c.id);
    return p ? { ...c, [p.field]: p.after } : c;
  });
}
