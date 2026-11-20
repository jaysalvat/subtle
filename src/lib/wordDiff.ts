/**
 * Word-level difference between two texts, to show what an AI proposal changes: the words kept,
 * removed and added, in reading order (spaces stay with the words around them).
 */
export interface DiffPart {
  text: string;
  kind: 'same' | 'del' | 'add';
}

/** Words with the spaces after them ("Tu ", "as "…): compared without the spaces. */
const tokens = (s: string) => s.match(/\S+\s*/g) ?? [];
const same = (x: string, y: string) => x.trimEnd() === y.trimEnd();

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  // Longest common subsequence of tokens (subtitles are short: the table stays small).
  const lcs = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = same(a[i], b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (text: string, kind: DiffPart['kind']) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    // Removed words before added ones: "~~Tu as~~ Vous avez".
    if (i < a.length && j < b.length && same(a[i], b[j])) push(b[(i++, j++)], 'same');
    else if (i < a.length && (j >= b.length || lcs[i + 1][j] >= lcs[i][j + 1])) push(a[i++], 'del');
    else push(b[j++], 'add');
  }
  // The space after a change stays outside its mark: "~~Tu as~~ Vous avez dit".
  return out.flatMap((p) => {
    const space = p.kind === 'same' ? '' : (/\s+$/.exec(p.text)?.[0] ?? '');
    return space
      ? [
          { ...p, text: p.text.slice(0, -space.length) },
          { text: space, kind: 'same' as const },
        ]
      : [p];
  });
}
