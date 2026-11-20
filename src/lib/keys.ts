/**
 * Shortcuts written in a text, e.g. "Add a bookmark (B)", "Zoom in (⌘ wheel)": found so the UI can
 * show them as key caps instead of "(B)". Only a bracket holding a key (modifiers allowed), optionally
 * followed by one word ("⌘ wheel"), counts; "(⌥ while dragging: off)" or "(s)" stay as they are.
 */
const KEY = '[⌘⌥⇧⌃]*(?:[A-Z0-9?]|[←→↑↓]|1–9|Esc|Échap|Enter|Entrée|Space|Espace)|[⌘⌥⇧⌃]+';
const SHORTCUT = new RegExp(`^((?:${KEY}))(?: (\\p{L}+))?$`, 'u');

export type KeyPart = string | { key: string };

/** The text cut into plain pieces and keys, the brackets of a shortcut dropped. */
export function keyParts(text: string): KeyPart[] {
  const out: KeyPart[] = [];
  let last = 0;
  for (const m of text.matchAll(/\(([^()]+)\)/g)) {
    const k = SHORTCUT.exec(m[1]);
    if (!k) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ key: k[1] });
    if (k[2]) out.push(` ${k[2]}`);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
