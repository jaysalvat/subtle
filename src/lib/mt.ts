/**
 * Machine translation: what goes to the engine and how the result comes back as a subtitle.
 * Engines translate plain sentences; markup, line breaks and italics are handled here.
 */
import { balanceText } from './lines';
import { editableText, isItalic, setItalic } from './markup';

const DASH = /^[-–—]\s*/;

/** A dialogue: two (or more) speakers, each line starting with a dash. */
export function isDialogue(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim());
  return lines.length > 1 && lines.every((l) => DASH.test(l.trim()));
}

/**
 * Plain text for the engine: no tags, lines joined (a sentence often spans both lines), except
 * dialogue lines, which stay one per speaker.
 */
export function mtInput(text: string): string {
  const plain = editableText(text).replace(/<[^>]+>|\{\\[^}]*\}/g, '');
  const lines = plain
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return isDialogue(plain) ? lines.join('\n') : lines.join(' ');
}

/**
 * A dialogue translation as one line per speaker, "- " each. Models often drop the dashes or the
 * line breaks: use the engine's lines when there are as many as speakers, else split on dashes, else
 * on sentence ends (cut where the original lines are cut, proportionally).
 */
export function dialogueLines(translated: string, speakers: number, sourceLines: string[] = []): string {
  const clean = (l: string) => l.replace(DASH, '').replace(/\s+/g, ' ').trim();
  const dash = (parts: string[]) => parts.map((p) => `- ${p}`).join('\n');
  const lines = translated.split('\n').map(clean).filter(Boolean);
  if (lines.length === speakers) return dash(lines);
  const flat = translated
    .replace(/\s*\n\s*/g, ' ')
    .trim()
    .replace(DASH, '');
  const byDash = flat
    .split(/\s+[-–—]\s*/)
    .map(clean)
    .filter(Boolean);
  if (byDash.length === speakers || speakers < 2) return dash(byDash);
  const sentences = flat
    .split(/(?<=[.!?…»"])\s+/)
    .map(clean)
    .filter(Boolean);
  if (sentences.length < speakers) return dash(byDash);
  // Cut points: where each original line ends, as a share of the whole text.
  const lens = sourceLines.length === speakers ? sourceLines.map((l) => l.length) : Array(speakers).fill(1);
  const total = lens.reduce((a, b) => a + b, 0);
  const sLen = sentences.map((x) => x.length + 1);
  const sTotal = sLen.reduce((a, b) => a + b, 0);
  const groups: string[][] = [];
  let i = 0;
  let acc = 0;
  let src = 0;
  for (let g = 0; g < speakers; g++) {
    src += lens[g];
    const group: string[] = [];
    const left = speakers - g - 1;
    while (i < sentences.length - left) {
      const before = Math.abs(acc / sTotal - src / total);
      const after = Math.abs((acc + sLen[i]) / sTotal - src / total);
      if (group.length && (g === speakers - 1 ? false : after > before)) break;
      group.push(sentences[i]);
      acc += sLen[i++];
      if (g < speakers - 1 && i >= sentences.length - left) break;
    }
    groups.push(group);
  }
  while (i < sentences.length) groups[speakers - 1].push(sentences[i++]);
  return dash(groups.map((g) => g.join(' ')));
}

/** One line when it fits, else two cut where a subtitler would (lib/lines.ts). */
export const fitLines = (text: string, maxLineLength: number, lang?: string) => balanceText(text.replace(/\s+/g, ' ').trim(), maxLineLength, lang);

/**
 * The engine's result as a translation: italic when the original is. Line breaks the engine chose
 * are kept when they fit (two lines at most, each short enough); otherwise the text is re-split.
 */
export function mtOutput(source: string, translated: string, maxLineLength: number, lang?: string): string {
  const plain = editableText(source);
  if (isDialogue(plain)) {
    const srcLines = mtInput(source).split('\n');
    const text = dialogueLines(translated, srcLines.length, srcLines);
    return isItalic(source) ? setItalic(text, true) : text;
  }
  const lines = translated
    .trim()
    .split(/\s*\n\s*/)
    .map((l) => l.replace(/\s+/g, ' ').trim());
  const fits = lines.length <= 2 && lines.every((l) => l && l.length <= maxLineLength);
  const text = fits ? lines.join('\n') : fitLines(translated, maxLineLength, lang);
  return isItalic(source) ? setItalic(text, true) : text;
}

/** Codes engines usually know: "pt-BR" → also try "pt", "zh-Hans" → "zh". */
export function engineLangCandidates(code: string): string[] {
  const base = code.split('-')[0];
  return base && base !== code ? [code, base] : [code];
}
