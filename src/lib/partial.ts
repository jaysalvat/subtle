/**
 * Texts that may be incomplete (a UI language being translated): a nested object whose leaves
 * (strings, functions, arrays) may be missing. Typed against the full shape, so a misnamed key is
 * still refused; a missing one is filled from the full version.
 */
type Leaf = string | number | boolean | ((...args: never[]) => unknown) | readonly unknown[];

export type DeepPartial<T> = T extends Leaf ? T : { [K in keyof T]?: DeepPartial<T[K]> };

const isBranch = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `partial` with every missing leaf taken from `full`. */
export function fillFrom<T>(full: T, partial: DeepPartial<T> | undefined): T {
  if (!isBranch(full) || !isBranch(partial)) return (partial ?? full) as T;
  const out: Record<string, unknown> = { ...full };
  for (const [k, v] of Object.entries(partial)) out[k] = fillFrom(full[k], v as DeepPartial<unknown>);
  return out as T;
}

/** Dotted paths of the leaves `partial` lacks ("tools.menu"). Free-form maps (`keyNames`) are leaves. */
export function missingKeys(full: unknown, partial: unknown, path = ''): string[] {
  // An empty object in English is a free-form map (key names): nothing in it is required.
  if (isBranch(full) && Object.keys(full).length === 0) return [];
  if (!isBranch(full) || !isBranch(partial)) return partial === undefined ? [path] : [];
  return Object.keys(full).flatMap((k) => missingKeys(full[k], partial[k], path ? `${path}.${k}` : k));
}
