/**
 * Claude (Anthropic API), called from the browser with the user's own key. One request per batch,
 * JSON answer enforced by structured outputs.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AiModel } from '../lib/mtAi';
import { AI_SCHEMA, type TokenCount } from '../lib/mtAi';

/** Models with the server-side fallback on a refusal (Haiku has none). */
const hasFallback = (model: string) => /^claude-(opus|fable|sonnet-5-5)/.test(model);
/** Models that take an effort level. */
const hasEffort = (model: string) => !/^claude-(haiku|sonnet)-4/.test(model);

export async function askClaude(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<{ text: string; usage: TokenCount }> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  try {
    const res = await client.beta.messages.create(
      {
        model,
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { ...(hasEffort(model) ? { effort: 'low' as const } : {}), format: { type: 'json_schema', schema: AI_SCHEMA } },
        ...(hasFallback(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );
    if (res.stop_reason === 'refusal') throw new Error('Claude declined to translate this part.');
    return {
      text: res.content.map((b) => (b.type === 'text' ? b.text : '')).join(''),
      usage: { input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0 },
    };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Claude refused the API key. Check it in Settings.');
    if (e instanceof Anthropic.NotFoundError) throw new Error(`Claude doesn't know the model “${model}”. Check it in Settings.`);
    if (e instanceof Anthropic.RateLimitError) throw new Error('Too many requests for this API key. Try again in a minute.');
    if (e instanceof Anthropic.APIError && e.status) throw new Error(`Claude: ${e.message}`);
    throw e;
  }
}

/** The models this key can use (Model list in Settings). */
export async function claudeModels(apiKey: string): Promise<AiModel[]> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const out: AiModel[] = [];
  for await (const m of client.models.list({ limit: 100 })) out.push({ id: m.id, name: m.display_name, created: Date.parse(m.created_at) / 1000 || 0 });
  return out;
}
