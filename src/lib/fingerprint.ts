/**
 * A video's fingerprint, whatever its name: its exact size and a SHA-256 of three 1 MB pieces
 * (start, middle, end). Reads 3 MB only, so it's instant even for a 4K film; a renamed file keeps it,
 * another file or a new encode doesn't. Same idea as video players' and subtitle sites' file hashes.
 */
const PIECE = 1024 * 1024;

const memo = new WeakMap<Blob, Promise<string>>();

export function videoFingerprint(file: Blob): Promise<string> {
  let p = memo.get(file);
  if (!p) memo.set(file, (p = compute(file)));
  return p;
}

async function compute(file: Blob): Promise<string> {
  const size = file.size;
  const starts = size <= 3 * PIECE ? [0] : [0, Math.floor(size / 2 - PIECE / 2), size - PIECE];
  const parts = await Promise.all(starts.map((s) => file.slice(s, size <= 3 * PIECE ? size : s + PIECE).arrayBuffer()));
  const all = new Uint8Array(parts.reduce((n, b) => n + b.byteLength, 0));
  let at = 0;
  for (const b of parts) {
    all.set(new Uint8Array(b), at);
    at += b.byteLength;
  }
  try {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
    const hex = Array.from(digest.slice(0, 16), (x) => x.toString(16).padStart(2, '0')).join('');
    return `${size}-${hex}`;
  } catch {
    // No SubtleCrypto (an insecure page): the size alone, as before.
    return `${size}`;
  }
}

/** Same video? By fingerprint when both have one, else by name and size (older projects). */
export function sameVideo(
  a: { name: string; size: number; fp?: string } | null | undefined,
  b: { name: string; size: number; fp?: string } | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.fp && b.fp) return a.fp === b.fp;
  return a.name === b.name && a.size === b.size;
}
