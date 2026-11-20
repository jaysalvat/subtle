/**
 * AI model engine: Claude, OpenAI, DeepSeek, Mistral, Gemini (your key) or a local server (Ollama / LM Studio). Translates in
 * batches with context; the subtitle text goes to the provider (stays on this computer when local).
 */
import { aiSystemPrompt, aiUserPrompt, parseAiReply } from '../lib/mtAi';
import { activeAiProvider, type Settings } from '../lib/types';
import type { Engine, EngineState, Session } from './engine';
/** The Anthropic SDK is loaded the first time Claude is asked (not in the app's first download). */
const askClaude: typeof import('./claude').askClaude = async (...args) => (await import('./claude')).askClaude(...args);
import { askOpenAI, OPENAI_COMPATIBLE } from './openai';

/** What's missing before it can translate, if anything. */
function missing(s: Settings): string | null {
  const p = activeAiProvider(s);
  if (p === 'local') {
    if (!s.aiBaseUrl.trim()) return 'Add the local server address in Settings › Translation.';
  } else if (!s.aiKeys[p]?.trim()) return 'Add an API key in Settings › Translation.';
  if (!s.aiModels[p]?.trim()) return 'Pick a model in Settings › Translation.';
  return null;
}

export const aiEngine: Engine = {
  id: 'ai',

  async status(_source, _target, settings): Promise<EngineState> {
    return missing(settings) ? 'nokey' : 'ready';
  },

  async open(source, target, settings, { signal }): Promise<Session> {
    const problem = missing(settings);
    if (problem) throw new Error(problem);
    const p = activeAiProvider(settings);
    const key = settings.aiKeys[p]?.trim() ?? '';
    const model = settings.aiModels[p].trim();
    const system = aiSystemPrompt(source, target, settings.maxLineLength, settings.maxCps);
    const ask = (user: string) =>
      p === 'anthropic'
        ? askClaude(key, model, system, user, signal)
        : askOpenAI(
            p === 'local' ? { baseUrl: settings.aiBaseUrl, apiKey: key || undefined, local: true } : { ...OPENAI_COMPATIBLE[p], apiKey: key },
            model,
            system,
            user,
            signal,
          );
    const usage = { input: 0, output: 0 };
    return {
      usage,
      async translateBatch(items, context, scenes, instruction, after) {
        const r = await ask(aiUserPrompt(items, context, scenes, instruction, after));
        usage.input += r.usage.input;
        usage.output += r.usage.output;
        return parseAiReply(r.text, items.length);
      },
      close() {},
    };
  },
};

/** Same engine on a local server (Ollama, LM Studio): picked as its own option in Settings. */
export const localEngine: Engine = { ...aiEngine, id: 'local' };

/**
 * The AI model of Settings › Translation, for other jobs (Shorten with AI). With Chrome picked as
 * the translator, the AI service set up there is used if it has a key.
 */
export const forAi = (s: Settings): Settings => (s.translationEngine === 'chrome' ? { ...s, translationEngine: 'ai' } : s);

/** The AI service and model the AI tools use: "DeepSeek", "deepseek-chat" (local: "Local model"). */
export function aiModelName(settings: Settings): { service: string; model: string } {
  const s = forAi(settings);
  const p = activeAiProvider(s);
  return { service: p === 'local' ? 'local' : p, model: s.aiModels[p]?.trim() ?? '' };
}

/** Why the AI model can't be used yet (null: ready). */
export const aiProblem = (s: Settings): string | null => missing(forAi(s));

/** One request to the AI model: the reply text and the tokens it took. */
export async function askAi(settings: Settings, system: string, user: string, signal?: AbortSignal) {
  const s = forAi(settings);
  const problem = missing(s);
  if (problem) throw new Error(problem);
  const p = activeAiProvider(s);
  const key = s.aiKeys[p]?.trim() ?? '';
  const model = s.aiModels[p].trim();
  return p === 'anthropic'
    ? askClaude(key, model, system, user, signal)
    : askOpenAI(
        p === 'local' ? { baseUrl: s.aiBaseUrl, apiKey: key || undefined, local: true } : { ...OPENAI_COMPATIBLE[p], apiKey: key },
        model,
        system,
        user,
        signal,
      );
}
