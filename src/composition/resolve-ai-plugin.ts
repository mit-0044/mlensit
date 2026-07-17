import {
  createAiAnalyzerPlugin,
  createGeminiProvider,
  createGroqProvider,
  createOpenAiProvider,
  selectProviderFromEnv,
  type AIProvider,
} from '@mlensit/ai';
import type { AnalyzerPlugin } from '@mlensit/core';

const VALID_PROVIDERS = ['groq', 'openai', 'gemini'] as const;
type ProviderId = (typeof VALID_PROVIDERS)[number];

function isProviderId(value: string): value is ProviderId {
  return (VALID_PROVIDERS as readonly string[]).includes(value);
}

function buildProvider(providerId: ProviderId, apiKey: string): AIProvider {
  const options = { apiKey, fetchImpl: fetch };
  switch (providerId) {
    case 'groq':
      return createGroqProvider(options);
    case 'openai':
      return createOpenAiProvider(options);
    case 'gemini':
      return createGeminiProvider(options);
  }
}

/**
 * Resolves the `@mlensit/ai` plugin from explicit CLI flags or, when
 * neither flag is supplied, from `MLENSIT_AI_PROVIDER` and the matching
 * `MLENSIT_<PROVIDER>_API_KEY` in `process.env` — the same pair the
 * plugin reads when declared in a project's `mlensit.config.json`.
 *
 * Returns `undefined` when no complete provider/key pair is available;
 * the caller skips AI analysis in that case without logging a warning
 * (the plugin not running at all is the "not configured" steady state).
 * When `providerFlag` is provided without `apiKeyFlag` the caller should
 * emit a warning before calling this function; this function returns
 * `undefined` in that case and falls back to the environment.
 */
export function resolveAiPlugin(
  providerFlag?: string,
  apiKeyFlag?: string,
): AnalyzerPlugin | undefined {
  if (providerFlag && apiKeyFlag) {
    if (!isProviderId(providerFlag)) {
      return undefined;
    }
    const provider = buildProvider(providerFlag, apiKeyFlag);
    return createAiAnalyzerPlugin(() => provider);
  }

  const envProvider = selectProviderFromEnv(process.env);
  if (!envProvider) {
    return undefined;
  }
  return createAiAnalyzerPlugin(() => envProvider);
}
