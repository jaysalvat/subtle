/**
 * Voice band filter: high-pass + low-pass biquads (RBJ cookbook), Q = 0.707.
 * Keeps roughly 300–3000 Hz, where speech intelligibility lives; attenuates rumble, explosions and cymbals.
 * Stateful, so a long track can be fed chunk by chunk.
 */

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

function biquad(kind: 'lowpass' | 'highpass', freq: number, sampleRate: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b1 = kind === 'lowpass' ? 1 - cos : -(1 + cos);
  const b0 = kind === 'lowpass' ? (1 - cos) / 2 : (1 + cos) / 2;
  return { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}

export class VoiceBandFilter {
  private stages: Biquad[];

  constructor(sampleRate: number, low = 300, high = 3000) {
    this.stages = [biquad('highpass', low, sampleRate), biquad('lowpass', high, sampleRate)];
  }

  /** Filter `input` into a new array, keeping state for the next call. */
  process(input: Float32Array): Float32Array {
    const out = new Float32Array(input);
    for (const f of this.stages) {
      let { x1, x2, y1, y2 } = f;
      const { b0, b1, b2, a1, a2 } = f;
      for (let i = 0; i < out.length; i++) {
        const x = out[i];
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        out[i] = y;
      }
      Object.assign(f, { x1, x2, y1, y2 });
    }
    return out;
  }
}
