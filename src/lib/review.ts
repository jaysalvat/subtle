/**
 * Review with AI: the AI model of Settings › Translation reads the subtitles in batches (with the
 * ones around for the sense) and proposes corrections: words misheard by speech-to-text, spelling,
 * grammar, punctuation, names written two ways. It only proposes; each one is accepted or not.
 * Pure parts: what goes in the prompt, reading the answer.
 */
import { languageName } from './languages';
import { editableText, sameWords, withEditedText } from './markup';
import { batchScenes, type SceneNote } from './sceneNotes';
import type { Cue } from './types';

export type ReviewKind = 'misheard' | 'spelling' | 'grammar' | 'punctuation' | 'consistency' | 'meaning' | 'missing' | 'address';
export const REVIEW_KINDS: ReviewKind[] = ['misheard', 'spelling', 'grammar', 'punctuation', 'consistency'];
/** Check the translation (against its original): what it looks for. */
export const CHECK_KINDS: ReviewKind[] = ['meaning', 'missing', 'address', 'consistency', 'spelling', 'grammar'];

export interface ReviewItem {
  n: number;
  text: string;
  /** Checking a translation: the original it translates. */
  original?: string;
  /** Checking a translation: its scene note's number (in the prompt's list). */
  scene?: number;
  /** The subtitles around it, for the sense (not to be corrected). */
  before?: string;
  after?: string;
}

export const REVIEW_BATCH = 40;

/** The text a review reads: the language edited (the caller passes `viewOf` cues while translating). */
const field = (c: Cue): 'text' | 'target' => (c.target !== undefined && c.target.trim() ? 'target' : 'text');
const plain = (c?: Cue) => (c ? editableText(c[field(c)] ?? '').replace(/\n/g, ' ') : undefined);

/** Items for these subtitles (empty ones left out), in film order, with their neighbours. */
export function reviewItems(cues: Cue[], ids: string[]): { items: ReviewItem[]; ids: string[] } {
  const set = new Set(ids);
  const items: ReviewItem[] = [];
  const picked: string[] = [];
  cues.forEach((c, i) => {
    if (!set.has(c.id)) return;
    const text = editableText(c[field(c)] ?? '');
    if (!text.trim()) return;
    items.push({ n: items.length + 1, text, before: plain(cues[i - 1]), after: plain(cues[i + 1]) });
    picked.push(c.id);
  });
  return { items, ids: picked };
}

export function reviewSystemPrompt(lang: string | undefined, fromAudio: boolean): string {
  const language = lang ? `${languageName(lang, 'en')} (${lang})` : 'the language of the text';
  return [
    `You are a careful subtitle proofreader. These film subtitles are in ${language}.${fromAudio ? ' They may have been made by speech recognition, so some words may have been misheard.' : ''}`,
    '',
    'Find what needs correcting:',
    '- "misheard": words that make no sense in context and were probably misheard (sound-alike words, wrong word boundaries). Give the most likely words that were said.',
    '- "spelling": spelling mistakes, typos, missing accents.',
    '- "grammar": agreement, conjugation, missing or wrong words.',
    '- "punctuation": missing or wrong punctuation, capitals at the start of sentences.',
    '- "consistency": a name or term written differently from the rest of the film.',
    '',
    'Rules:',
    '- Change as little as possible. Keep the meaning, the tone, slang and the way people speak: correct mistakes, not style.',
    '- Keep line breaks ("\\n") and lines starting with "-" (one speaker each) as they are, unless the mistake is there.',
    '- "before" and "after" are the subtitles around it, for the sense only: never correct them, never return their text.',
    '- Each change is the corrected text of the subtitle with that same "n", nothing else.',
    '- Return only the subtitles that need a change, each with its whole corrected text, the kind of change, and a short reason (a few words, in English).',
    '- When nothing needs correcting, return an empty list.',
    '',
    'Answer with JSON only: {"changes":[{"n":3,"text":"…","kind":"misheard","reason":"…"}]}',
  ].join('\n');
}

export function reviewUserPrompt(items: ReviewItem[]): string {
  return 'Review:\n' + JSON.stringify({ subtitles: items });
}

export interface ReviewChange {
  text: string;
  kind: ReviewKind;
  reason: string;
}

/** The model's answer → changes by item number (unknown kinds count as spelling; bad entries dropped). */
export function parseReview(reply: string, count: number, kinds: ReviewKind[] = REVIEW_KINDS): Map<number, ReviewChange> {
  const out = new Map<number, ReviewChange>();
  const start = reply.search(/[[{]/);
  if (start < 0) return out;
  const end = Math.max(reply.lastIndexOf('}'), reply.lastIndexOf(']'));
  let data: unknown;
  try {
    data = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return out;
  }
  const list = Array.isArray(data) ? data : (data as { changes?: unknown })?.changes;
  if (!Array.isArray(list)) return out;
  for (const it of list as Record<string, unknown>[]) {
    const n = Number(it?.n);
    const text = it?.text;
    if (!Number.isInteger(n) || n < 1 || n > count || typeof text !== 'string' || !text.trim()) continue;
    const kind = kinds.includes(it.kind as ReviewKind) ? (it.kind as ReviewKind) : kinds[0] === 'misheard' ? 'spelling' : kinds[0];
    out.set(n, { text: text.replace(/\\n/g, '\n').trim(), kind, reason: typeof it.reason === 'string' ? it.reason.trim() : '' });
  }
  return out;
}

/** How alike two texts are, 0…1 (letter pairs in common; case, accents and punctuation ignored). */
export function similarity(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const pairs = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const x = norm(a);
  const y = norm(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const px = pairs(x);
  const py = pairs(y);
  let common = 0;
  for (const [k, n] of px) common += Math.min(n, py.get(k) ?? 0);
  return (2 * common) / (x.length - 1 + y.length - 1);
}

/** A correction looks like the subtitle it corrects: below this, it was put on the wrong number. */
export const SAME_TEXT = 0.45;

/**
 * Models sometimes put a correction on the wrong number (the one before or after). Each correction
 * goes to the subtitle it really looks like in the batch; one that looks like none is dropped.
 */
export function alignChanges(items: ReviewItem[], got: Map<number, ReviewChange>): Map<number, ReviewChange> {
  const out = new Map<number, ReviewChange>();
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  for (const [n, ch] of got) {
    const own = items.find((it) => it.n === n);
    const ownScore = own ? similarity(own.text, ch.text) : 0;
    let best: ReviewItem | null = null;
    let bestScore = 0;
    for (const it of items) {
      if (it.n === n) continue;
      const s = similarity(it.text, ch.text);
      if (s > bestScore) [best, bestScore] = [it, s];
    }
    // Clearly another subtitle's text: it goes there (when that one has no correction of its own).
    if (best && bestScore >= 0.6 && bestScore > ownScore + 0.2) {
      if (!out.has(best.n) && !got.has(best.n)) out.set(best.n, ch);
      continue;
    }
    // A correction of the context given around it ("before" / "after", another batch's subtitle,
    // corrected there): not this one's.
    const context = own ? Math.max(similarity(own.before ?? '', ch.text), similarity(own.after ?? '', ch.text)) : 0;
    if (context >= 0.6 && context > ownScore + 0.2) continue;
    // Its own: alike enough, or short (a misheard word can change a short line completely).
    if (own && !out.has(n) && (ownScore >= SAME_TEXT || words(own.text) <= 3)) out.set(n, ch);
  }
  return out;
}

export interface ReviewProposal {
  id: string;
  field: 'text' | 'target';
  before: string;
  after: string;
  kind: ReviewKind;
  reason: string;
}

/** Changes → proposals (markup kept: position, whole-subtitle italics). Unchanged ones dropped. */
export function reviewProposals(cues: Cue[], ids: string[], items: ReviewItem[], got: Map<number, ReviewChange>): ReviewProposal[] {
  const byId = new Map(cues.map((c) => [c.id, c]));
  const aligned = alignChanges(items, got);
  const out: ReviewProposal[] = [];
  items.forEach((it, i) => {
    const ch = aligned.get(it.n);
    const c = byId.get(ids[i]);
    if (!ch || !c) return;
    const f = field(c);
    const before = c[f] ?? '';
    const after = withEditedText(before, ch.text);
    // The same text (spaces aside): nothing to propose.
    if (sameWords(editableText(after), editableText(before))) return;
    out.push({ id: c.id, field: f, before, after, kind: ch.kind, reason: ch.reason });
  });
  return out;
}

/** Rough tokens for a review (about 4 characters a token; the answer: a fraction of the text). */
export function estimateReview(items: ReviewItem[], batches: number): { input: number; output: number } {
  const chars = items.reduce((n, it) => n + it.text.length + (it.original?.length ?? 0) + (it.before?.length ?? 0) + (it.after?.length ?? 0) + 30, 0);
  return { input: Math.round(chars / 4 + batches * 450), output: Math.round(items.reduce((n, it) => n + it.text.length, 0) / 4 / 4 + batches * 20) };
}

/*
 * Check the translation with AI: the same proposals, but the model reads
 * each translation next to its original, with the scene notes, and looks for what a translation
 * gets wrong: meaning, something left out, tu / vous, names translated two ways.
 */

/** Translated subtitles among `ids` (untranslated ones left out), with their original and scene. */
export function checkItems(cues: Cue[], ids: string[], notes: SceneNote[]): { items: ReviewItem[]; ids: string[]; scenes: string[] } {
  const set = new Set(ids);
  const picked = cues.filter((c) => set.has(c.id) && c.target?.trim() && editableText(c.text).trim());
  const { scenes, sceneOf } = batchScenes(picked, notes);
  const at = new Map(cues.map((c, i) => [c.id, i]));
  const tr = (c?: Cue) => (c?.target?.trim() ? editableText(c.target).replace(/\n/g, ' ') : undefined);
  const items = picked.map((c, k) => {
    const i = at.get(c.id)!;
    return {
      n: k + 1,
      original: editableText(c.text),
      text: editableText(c.target!),
      before: tr(cues[i - 1]),
      after: tr(cues[i + 1]),
      ...(sceneOf[k] ? { scene: sceneOf[k] } : {}),
    };
  });
  return { items, ids: picked.map((c) => c.id), scenes };
}

export function checkSystemPrompt(source: string, target: string): string {
  return [
    `You are a careful subtitle translation reviewer. Each item has the original film subtitle in ${languageName(source, 'en')} (${source}), "original", and its translation into ${languageName(target, 'en')} (${target}), "text".`,
    '',
    'Find what needs correcting in the translation:',
    '- "meaning": a mistranslation: the wrong meaning, a lost negation, a changed number or name, who does what reversed.',
    '- "missing": something that matters in the original is left out. Subtitles are condensed on purpose: only flag a real loss.',
    '- "address": forms of address (e.g. tu / vous) or register that don\'t fit the scene note or change within a scene.',
    '- "consistency": a name or term translated differently from the rest of the film.',
    '- "spelling", "grammar": mistakes in the translation.',
    '',
    'Rules:',
    "- Change as little as possible: keep the translation's wording, tone and length (reading speed) when they are right.",
    '- Keep line breaks ("\\n") and lines starting with "-" (one speaker each).',
    '- A "scene" number refers to that scene note (who is there, who speaks to whom, the tone).',
    '- "before" and "after" are the translations around it, for the sense only: never correct them, never return their text.',
    '- Never return the original. Each change is the corrected translation of the item with that same "n".',
    '- Return only the items that need a change, each with its whole corrected translation, the kind, and a short reason (a few words, in English).',
    '- When nothing needs correcting, return an empty list.',
    '',
    'Answer with JSON only: {"changes":[{"n":3,"text":"…","kind":"meaning","reason":"…"}]}',
  ].join('\n');
}

export function checkUserPrompt(items: ReviewItem[], scenes: string[]): string {
  const notes = scenes.length ? ['Scene notes:', ...scenes.map((s, i) => `${i + 1}. ${s}`), ''] : [];
  return [...notes, 'Check:', JSON.stringify({ subtitles: items })].join('\n');
}
