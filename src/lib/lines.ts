/**
 * Balance lines: one line when the text fits, else two, cut where a subtitler would (Netflix's and
 * Prime Video's line treatment): after a sentence end or a comma, before a conjunction or a
 * preposition, never right after an article, a preposition or a subject pronoun; then the two lines
 * as even as possible, the bottom one a little longer rather than the top (a pyramid).
 * Tags stay on their words; dialogue lines ("- …", one per speaker) are kept as they are.
 */
import { editableText, withEditedText } from './markup';
import { isDialogue } from './mt';
import type { Cue } from './types';

/** Words a line shouldn't end on (they belong with the next word), and words a second line starts well with. */
interface Words {
  glue: Set<string>;
  starts: Set<string>;
}

const words = (glue: string, starts: string): Words => ({ glue: new Set(glue.split(' ')), starts: new Set(starts.split(' ')) });

const WORDS: Record<string, Words> = {
  en: words(
    "a an the this that these those my your his her its our their to of in on at by for with from into and or but as than if i you he she we they i'm you're he's she's we're they're i'll i've i'd it's not no very will would can could should must have has had am is are was were be been mr. mrs. ms. dr.",
    'and or but because so that which who when where why how what while if than to of in on at by for with from into about after before until',
  ),
  fr: words(
    "le la les l' un une des du de d' au aux ce cet cette ces mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs je j' tu il elle on nous vous ils elles ne n' que qu' qui à en et ou mais très plus pour par sur dans avec sans chez suis es est sommes êtes sont ai as avons avez ont vais vas va allons allez vont m. mme",
    "et ou mais car donc parce puisque quand lorsque si comme pourquoi comment qui que qu' dont où pour par sur sous dans avec sans chez vers à de d' depuis pendant avant après jusqu'à",
  ),
  es: words(
    'el la los las un una unos unas de del al a en y o pero que mi mis tu tus su sus nuestro nuestra yo tú él ella nosotros ellos no muy se me te le lo sr. sra.',
    'y o pero porque que cuando donde si como para por con sin en de a desde hasta sobre',
  ),
  de: words(
    'der die das den dem des ein eine einen einem einer zu von mit für in an auf und oder aber ich du er sie es wir ihr nicht sehr hr. fr.',
    'und oder aber weil dass wenn ob als wie für mit von zu nach bei aus über unter ohne',
  ),
  it: words(
    "il lo la i gli le l' un uno una un' di del della dei a al alla in nel e o ma che io tu lui lei noi voi loro non molto mi ti si ci sig.",
    'e o ma perché che quando dove se come per con senza in di a da su tra fra dopo prima',
  ),
};

const NO_WORDS: Words = { glue: new Set(), starts: new Set() };
const wordsFor = (lang?: string) => WORDS[(lang ?? '').toLowerCase().split('-')[0]] ?? NO_WORDS;

/** A word as compared with the lists: no tags, no punctuation around it, curly apostrophes straight, lower case. */
const bare = (word: string) =>
  word
    .replace(/<[^>]*>|\{[^}]*\}/g, '')
    .replace(/’/g, "'")
    .replace(/^[«"“(¿¡-]+|[»"”),.!?;:…]+$/g, '')
    .toLowerCase();
const shown = (word: string) => word.replace(/<[^>]*>|\{[^}]*\}/g, '');

/** Words with the tags around them (a tag may hold a space, <font color="…">); never cut inside one. */
const tokens = (text: string) => text.match(/(?:<[^>]*>|\{[^}]*\}|\S)+/g) ?? [];

/** How much worse than the best cut an existing one may be and stay (a few characters of balance). */
const KEEP_MARGIN = 5;

/** What breaking before word `k` costs: lower is better. */
function breakCost(ws: string[], k: number, list: Words, max: number): number {
  const top = ws.slice(0, k).map(shown).join(' ').length;
  const bottom = ws.slice(k).map(shown).join(' ').length;
  if (top > max || bottom > max) return 1000 + Math.max(top, bottom) - max;
  const before = shown(ws[k - 1]);
  const after = bare(ws[k]);
  // Even lines; a top line longer than the bottom one costs a little more (a pyramid reads better).
  let cost = Math.abs(top - bottom) + (top > bottom ? 3 : 0);
  if (/[.!?…]["”»)]?$/.test(before)) cost -= 25;
  else if (/[,;:]["”»)]?$/.test(before)) cost -= 18;
  else if (/^[-–—]/.test(ws[k])) cost -= 18;
  if (list.starts.has(after)) cost -= 10;
  if (list.glue.has(bare(ws[k - 1])) || /['’]$/.test(before)) cost += 30;
  // First name + last name, "New York": two capitalised words in a row stay together (not a sentence start).
  if (/^\p{Lu}/u.test(shown(ws[k])) && /^\p{Lu}/u.test(before) && k > 1 && !/[.!?…]$/.test(shown(ws[k - 2]))) cost += 15;
  return cost;
}

/** A text (no hidden markup) on one line when it fits, else on the two lines that read best. */
export function balanceText(text: string, maxLineLength: number, lang?: string): string {
  if (isDialogue(text)) return text;
  const ws = tokens(text);
  const oneLine = ws.join(' ');
  if (ws.length < 2 || ws.map(shown).join(' ').length <= maxLineLength) return oneLine;
  const list = wordsFor(lang);
  let best = 1;
  let bestCost = Infinity;
  for (let k = 1; k < ws.length; k++) {
    const cost = breakCost(ws, k, list, maxLineLength);
    if (cost < bestCost) [best, bestCost] = [k, cost];
  }
  // Two lines already cut about as well: the subtitler's choice stays.
  const lines = text.split('\n');
  if (lines.length === 2) {
    const kept = tokens(lines[0]).length;
    if (kept > 0 && kept < ws.length && breakCost(ws, kept, list, maxLineLength) <= bestCost + KEEP_MARGIN)
      return `${tokens(lines[0]).join(' ')}\n${tokens(lines[1]).join(' ')}`;
  }
  return `${ws.slice(0, best).join(' ')}\n${ws.slice(best).join(' ')}`;
}

/** A subtitle's text balanced, its hidden markup (position, whole italics, colour) kept. */
export const balanceCueText = (text: string, maxLineLength: number, lang?: string) =>
  withEditedText(text, balanceText(editableText(text), maxLineLength, lang));

export interface BalanceResult {
  cues: Cue[];
  /** The subtitles whose lines changed, before and after (shown as they're edited). */
  changed: { id: string; before: string; after: string }[];
}

/** Tools › Balance lines on `field` (the translation while translating), the subtitles in `ids` or all. */
export function balanceLines(cues: Cue[], maxLineLength: number, lang: string | undefined, field: 'text' | 'target' = 'text', ids?: string[]): BalanceResult {
  const only = ids && new Set(ids);
  const changed: BalanceResult['changed'] = [];
  const out = cues.map((c) => {
    const text = c[field];
    if (text === undefined || (only && !only.has(c.id))) return c;
    const after = balanceCueText(text, maxLineLength, lang);
    if (after === text) return c;
    changed.push({ id: c.id, before: editableText(text), after: editableText(after) });
    return { ...c, [field]: after };
  });
  return { cues: out, changed };
}
