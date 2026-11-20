/** Models the user can pick, asked from the provider or the local server (Model list in Settings). */
import { translationModels, type AiModel } from '../lib/mtAi';
import type { AiProvider, Settings } from '../lib/types';
import { openAIModels, OPENAI_COMPATIBLE } from './openai';

/** Empty when the provider isn't set up yet (no key, no address). */
export async function listModels(p: AiProvider, s: Pick<Settings, 'aiKeys' | 'aiBaseUrl'>): Promise<AiModel[]> {
  const key = s.aiKeys[p]?.trim() ?? '';
  // The Anthropic SDK is loaded the first time it's needed (not in the app's first download).
  if (p === 'anthropic') return key ? translationModels(p, await (await import('./claude')).claudeModels(key)) : [];
  if (p !== 'local')
    return key
      ? translationModels(
          p,
          (await openAIModels({ ...OPENAI_COMPATIBLE[p], apiKey: key })).map((m) => ({ ...m, name: m.id })),
        )
      : [];
  if (!s.aiBaseUrl.trim()) return [];
  return translationModels(
    p,
    (await openAIModels({ baseUrl: s.aiBaseUrl, apiKey: key || undefined, local: true })).map((m) => ({ ...m, name: m.id })),
  );
}
