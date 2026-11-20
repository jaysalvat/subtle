/** Pure helpers for menus (src/components/Menu.tsx). */

/**
 * Sections in `n` columns, in order, the columns as even as can be (a section is never split).
 * Each column is a list of sections, each section its items.
 */
export function menuColumns<T extends { section?: string }>(items: T[], n: number): T[][][] {
  const sections: T[][] = [];
  for (const it of items) {
    if (it.section || !sections.length) sections.push([]);
    sections[sections.length - 1].push(it);
  }
  const cols: T[][][] = [];
  let left = items.length;
  for (let s = 0; s < sections.length;) {
    const target = left / (n - cols.length);
    const col: T[][] = [];
    let size = 0;
    // Add sections while it gets closer to an even share (the last column takes the rest).
    while (s < sections.length && (cols.length === n - 1 || !col.length || Math.abs(size + sections[s].length - target) <= Math.abs(size - target))) {
      size += sections[s].length;
      col.push(sections[s++]);
    }
    cols.push(col);
    left -= size;
  }
  return cols;
}

/**
 * Items sorted by label (in `locale`) within each section, sections kept in order; the section's
 * name moves to its new first item.
 */
export function sortInSections<T extends { section?: string; label: string }>(items: T[], locale: string): T[] {
  const sections: { name?: string; items: T[] }[] = [];
  for (const it of items) {
    if (it.section || !sections.length) sections.push({ name: it.section, items: [] });
    sections[sections.length - 1].items.push(it);
  }
  return sections.flatMap(({ name, items: its }) =>
    [...its].sort((a, b) => a.label.localeCompare(b.label, locale, { sensitivity: 'base' })).map((it, i) => ({ ...it, section: i === 0 ? name : undefined })),
  );
}
