import { aiEngine, localEngine } from './ai';
import { chromeEngine } from './chrome';
import type { Engine, EngineId } from './engine';
import { mtInput, mtOutput } from '../lib/mt';
import { AI_CONTEXT, aiBatches, aiItems, filmContext, type AiContext } from '../lib/mtAi';
import type { Cue, Settings } from '../lib/types';
import { batchScenes, type SceneNote } from '../lib/sceneNotes';

/** The subtitles just before `cue` in the list, with their translations so far. */
function contextBefore(cues: Cue[], cue: Cue, out: Map<string, string>): AiContext[] {
  const i = cues.indexOf(cue);
  return cues.slice(Math.max(0, i - AI_CONTEXT), i).map((c) => ({ text: mtInput(c.text), translation: out.get(c.id) }));
}

export const ENGINES: Record<EngineId, Engine> = {
  chrome: chromeEngine,
  ai: aiEngine,
  local: localEngine,
};

/**
 * Translate subtitles, one by one or in batches with context (depending on the engine). Returns
 * translations by cue id; stopping (signal) keeps what's done.
 */
export async function translateCues(
  engine: Engine,
  cues: Cue[],
  source: string,
  target: string,
  settings: Settings,
  opts: {
    onDownload?: (p: number) => void;
    onProgress?: (done: number, total: number) => void;
    /** Called as translations come in (each batch, or every few subtitles), to show them live. */
    onPartial?: (out: Map<string, string>) => void;
    /** Tokens used so far (AI services), after each batch. */
    onUsage?: (usage: { input: number; output: number }) => void;
    /** Scene notes: each subtitle goes with its scene's (AI models). */
    notes?: SceneNote[];
    /** What the person editing asks for these subtitles ("vouvoyer", "shorter"): AI models. */
    instruction?: string;
    /** The whole film, when only some subtitles are translated again: what's around them goes as context. */
    film?: Cue[];
    signal?: AbortSignal;
  },
): Promise<Map<string, string>> {
  const maxLineLength = settings.maxLineLength;
  const out = new Map<string, string>();
  const session = await engine.open(source, target, settings, opts);
  try {
    let done = 0;
    if (session.translateBatch) {
      let context: AiContext[] = [];
      for (const batch of aiBatches(cues)) {
        if (opts.signal?.aborted) break;
        // Models sometimes skip or merge a few lines: ask again for the missing ones (smaller, so
        // easier), up to twice, with the subtitles just before them as context.
        let todo = batch;
        for (let round = 0; round < 3 && todo.length; round++) {
          let got: Map<number, string>;
          try {
            const { scenes, sceneOf } = batchScenes(todo, opts.notes ?? []);
            const around = opts.film ? filmContext(opts.film, todo, out) : null;
            const before = around ? around.before : round === 0 ? context : contextBefore(cues, todo[0], out);
            got = await session.translateBatch(aiItems(todo, sceneOf), before, scenes, opts.instruction, around?.after);
          } catch (e) {
            if (opts.signal?.aborted) break;
            throw e;
          }
          todo.forEach((c, i) => {
            const tr = got.get(i + 1);
            if (tr) out.set(c.id, mtOutput(c.text, tr, maxLineLength, target));
          });
          todo = todo.filter((c) => !out.has(c.id));
          if (opts.signal?.aborted) break;
        }
        opts.onPartial?.(out);
        if (session.usage) opts.onUsage?.({ ...session.usage });
        context = batch.slice(-AI_CONTEXT).map((c) => ({ text: mtInput(c.text), translation: out.get(c.id) }));
        done += batch.length;
        opts.onProgress?.(Math.min(done, cues.length), cues.length);
      }
      return out;
    }
    for (const c of cues) {
      if (opts.signal?.aborted) break;
      const input = mtInput(c.text);
      if (input) {
        try {
          // Dialogue: one speaker at a time, so the engine can't run them together.
          const parts = await Promise.all(input.split('\n').map((l) => session.translate!(l)));
          out.set(c.id, mtOutput(c.text, parts.join('\n'), maxLineLength, target));
        } catch (e) {
          if (opts.signal?.aborted) break;
          throw e;
        }
      }
      opts.onProgress?.(++done, cues.length);
      if (done % 10 === 0) opts.onPartial?.(out);
    }
  } finally {
    session.close();
  }
  return out;
}
