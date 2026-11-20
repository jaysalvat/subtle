/**
 * OpenAI Chat Completions, called from the browser. Also used for the services that speak the same
 * API (DeepSeek, Mistral, Gemini) and for local servers (Ollama, LM Studio): only the address changes (no
 * key needed locally). One request per batch.
 */
import { AI_SCHEMA, type TokenCount } from '../lib/mtAi';

export const OPENAI_URL = 'https://api.openai.com/v1';

/** Services with the OpenAI API: address and the name shown in messages. All allow browser calls (CORS). */
export const OPENAI_COMPATIBLE = {
  openai: { baseUrl: OPENAI_URL, name: 'OpenAI' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', name: 'DeepSeek' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', name: 'Mistral' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', name: 'Gemini' },
} as const;

export interface OpenAIServer {
  baseUrl: string;
  apiKey?: string;
  /** Shown in messages (defaults to OpenAI). */
  name?: string;
  /** A local server (Ollama, LM Studio). */
  local?: boolean;
}

const trimUrl = (u: string) => u.trim().replace(/\/+$/, '');

async function call(server: OpenAIServer, path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (server.apiKey) headers.Authorization = `Bearer ${server.apiKey}`;
  try {
    return await fetch(trimUrl(server.baseUrl) + path, { ...init, headers });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error(
      server.local
        ? `Can’t reach the local server at ${server.baseUrl}. Is Ollama or LM Studio running? (In LM Studio, turn on CORS in the server settings.)`
        : `Can’t reach ${server.name ?? 'OpenAI'}. Check your connection.`,
    );
  }
}

export async function askOpenAI(
  server: OpenAIServer,
  model: string,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<{ text: string; usage: TokenCount }> {
  const res = await call(server, '/chat/completions', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // Local servers (LM Studio) only take a JSON schema; OpenAI's JSON mode is enough there.
      response_format: server.local ? { type: 'json_schema', json_schema: { name: 'subtitles', schema: AI_SCHEMA } } : { type: 'json_object' },
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const who = server.local ? 'The local server' : (server.name ?? 'OpenAI');
    if (res.status === 401) throw new Error(`${who} refused the API key. Check it in Settings.`);
    if (res.status === 404) throw new Error(`${who} doesn’t know the model “${model}”. Check it in Settings.`);
    if (res.status === 402) throw new Error(`${who}: no credit left on this account.`);
    if (res.status === 429) throw new Error('Too many requests for this API key (or no credit left). Try again later.');
    // Gemini answers errors as a list: [{ error: { message } }].
    const err = Array.isArray(data) ? data[0]?.error : data?.error;
    throw new Error(`${who}: ${err?.message ?? err ?? res.statusText}`);
  }
  return {
    text: data?.choices?.[0]?.message?.content ?? '',
    usage: { input: data?.usage?.prompt_tokens ?? 0, output: data?.usage?.completion_tokens ?? 0 },
  };
}

export async function openAIModels(server: OpenAIServer): Promise<{ id: string; created: number }[]> {
  const res = await call(server, '/models');
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as { data?: { id: string; created?: number }[] };
  return (data.data ?? []).map((m) => ({ id: m.id, created: m.created ?? 0 }));
}
