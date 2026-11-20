export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

/**
 * Decode a subtitle file. Many French .srt files are Windows-1252, not UTF-8:
 * we honour a BOM, then try strict UTF-8, then fall back to Windows-1252.
 */
export function decodeSubtitleBytes(buf: ArrayBuffer | Uint8Array): { text: string; encoding: TextEncodingName } {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

export function encodeUtf8(text: string, bom: boolean): Blob {
  const parts: BlobPart[] = [];
  if (bom) parts.push(new Uint8Array([0xef, 0xbb, 0xbf]));
  parts.push(text);
  return new Blob(parts, { type: 'text/plain;charset=utf-8' });
}
