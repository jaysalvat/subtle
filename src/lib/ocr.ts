/**
 * Text on the picture (OCR), pure parts: boxes from PaddleOCR's detection map, and CTC decoding of
 * its recognition output. Models and runtime in src/workers/ocr.worker.ts.
 */

export interface OcrBox {
  /** The line's rectangle before rotation, in image pixels: rotated by `angle` around its centre. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians, clockwise (text on a tilted phone, a sign at an angle). */
  angle: number;
}

export interface OcrLine extends OcrBox {
  text: string;
  /** 0…1, mean confidence of the characters. */
  score: number;
}

/**
 * Text boxes from the detection probability map (`w` × `h`, one value per pixel): pixels above
 * `thresh` grouped into connected regions, kept when their mean probability reaches `boxThresh`.
 * Each region gets the rectangle along its main direction (so tilted text keeps a tight box), grown
 * by PaddleOCR's "unclip" (the map is drawn a little inside the text).
 */
export function boxesFromMap(map: Float32Array, w: number, h: number, thresh = 0.3, boxThresh = 0.5, unclip = 1.6, minSide = 3): OcrBox[] {
  const seen = new Uint8Array(w * h);
  const out: OcrBox[] = [];
  const stack: number[] = [];
  const pixels: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || map[start] < thresh) continue;
    let sum = 0;
    let mx = 0;
    let my = 0;
    pixels.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      pixels.push(p);
      sum += map[p];
      mx += x;
      my += y;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q] || map[q] < thresh) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    const n = pixels.length;
    if (sum / n < boxThresh) continue;
    mx /= n;
    my /= n;
    // Main direction from the second moments.
    let sxx = 0,
      syy = 0,
      sxy = 0;
    for (const p of pixels) {
      const dx = (p % w) - mx;
      const dy = Math.floor(p / w) - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    // Short or nearly square regions: no reliable direction, keep them level.
    if (Math.abs(angle) > Math.PI / 4) angle = 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity;
    for (const p of pixels) {
      const dx = (p % w) - mx;
      const dy = Math.floor(p / w) - my;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const len = u1 - u0 + 1;
    const thick = v1 - v0 + 1;
    if (Math.min(len, thick) < minSide) continue;
    const d = (len * thick * unclip) / (2 * (len + thick));
    const bw = len + 2 * d;
    const bh = thick + 2 * d;
    // Centre of the rectangle, back in image coordinates.
    const cu = (u0 + u1) / 2;
    const cv = (v0 + v1) / 2;
    const cx = mx + cu * cos - cv * sin;
    const cy = my + cu * sin + cv * cos;
    out.push({ x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, angle });
  }
  // Reading order: top to bottom, then left to right.
  return out.sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) / 2 ? a.x - b.x : a.y - b.y));
}

/**
 * Greedy CTC decoding of `logits` (T steps × C classes): best class per step, repeats collapsed,
 * blank (class 0) dropped. Class i ≥ 1 is `dict[i - 1]`; the class after the dictionary is a space.
 */
export function ctcDecode(logits: Float32Array, T: number, C: number, dict: string[]): { text: string; score: number } {
  let text = '';
  let prev = -1;
  let sum = 0;
  let n = 0;
  for (let t = 0; t < T; t++) {
    let best = 0;
    let bestV = -Infinity;
    for (let c = 0; c < C; c++) {
      const v = logits[t * C + c];
      if (v > bestV) {
        bestV = v;
        best = c;
      }
    }
    if (best !== 0 && best !== prev) {
      text += best - 1 < dict.length ? dict[best - 1] : ' ';
      sum += bestV;
      n++;
    }
    prev = best;
  }
  return { text: text.replace(/\s+/g, ' ').trim(), score: n ? sum / n : 0 };
}

/** Lines picked in the picture → subtitle text, in the order they were picked, one line each. */
export function ocrText(lines: OcrLine[]): string {
  return lines
    .map((l) => l.text)
    .filter(Boolean)
    .join('\n');
}
