/**
 * Wherever the AI is called, the same recognisable block: who does it ("DeepSeek · deepseek-chat",
 * the subtitle text goes there except to a local model), then what it costs — before the run
 * "1,626 subtitles · about 64k tokens sent, 3.6k received", after it the tokens actually used.
 * AI services are paid per token: no prices (they change).
 */
import { t } from '../i18n';
import { aiModelName } from '../mt/ai';
import { useApp } from '../store/store';

/** 95 400 → "95k", 4 200 → "4.2k". */
export const kTokens = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`);

export interface TokenUse {
  input: number;
  output: number;
}

export function AiCall({
  suffix,
  who,
  estimate,
  used,
}: {
  /** After the model ("ready", "checking…"). */
  suffix?: string;
  /** Another engine than the AI of the settings (translation in Chrome, a local model). */
  who?: { name: string; model?: string };
  /** Before the run: what it will roughly take, for `count` subtitles. */
  estimate?: (TokenUse & { count: number }) | null;
  /** After (or during) the run: the tokens used so far; until some are counted, `estimate` shows. */
  used?: TokenUse;
}) {
  const settings = useApp((s) => s.settings);
  const fromSettings = () => {
    const { service, model } = aiModelName(settings);
    return { name: service === 'local' ? t.mt.localName : t.mt.ai.providers[service as keyof typeof t.mt.ai.providers], model };
  };
  const { name, model } = who ?? fromSettings();
  return (
    <div className="ai-call note">
      <span>
        <strong className="ai-call-name">{name}</strong>
        {model && (
          <>
            {' · '}
            <span className="ai-call-name">{model}</span>
          </>
        )}
        {suffix ? ` · ${suffix}` : ''}
      </span>
      {used && used.input > 0 ? (
        <span>{t.aiCall.used(kTokens(used.input), kTokens(used.output))}</span>
      ) : (
        estimate && estimate.count > 0 && <span>{t.aiCall.estimate(estimate.count, kTokens(estimate.input), kTokens(estimate.output))}</span>
      )}
    </div>
  );
}
