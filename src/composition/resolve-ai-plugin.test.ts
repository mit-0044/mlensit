import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAiPlugin } from './resolve-ai-plugin.js';

const AI_ENV_VARS = [
  'MLENSIT_AI_PROVIDER',
  'MLENSIT_GROQ_API_KEY',
  'MLENSIT_OPENAI_API_KEY',
  'MLENSIT_GEMINI_API_KEY',
] as const;

describe('resolveAiPlugin', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of AI_ENV_VARS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of AI_ENV_VARS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('returns undefined when no flags and no env vars are set', () => {
    expect(resolveAiPlugin()).toBeUndefined();
  });

  it('returns an AnalyzerPlugin named @mlensit/ai for the groq provider flag', () => {
    const plugin = resolveAiPlugin('groq', 'test-key');
    expect(plugin).toBeDefined();
    expect(plugin?.name).toBe('@mlensit/ai');
  });

  it('returns an AnalyzerPlugin for the openai provider flag', () => {
    const plugin = resolveAiPlugin('openai', 'test-key');
    expect(plugin).toBeDefined();
    expect(plugin?.name).toBe('@mlensit/ai');
  });

  it('returns an AnalyzerPlugin for the gemini provider flag', () => {
    const plugin = resolveAiPlugin('gemini', 'test-key');
    expect(plugin).toBeDefined();
    expect(plugin?.name).toBe('@mlensit/ai');
  });

  it('returns undefined for an unrecognized provider flag, even with a key', () => {
    expect(resolveAiPlugin('anthropic', 'test-key')).toBeUndefined();
  });

  it('returns undefined when only the provider flag is given without a key (falls through to env vars, none set)', () => {
    expect(resolveAiPlugin('groq', undefined)).toBeUndefined();
  });

  it('falls back to MLENSIT_AI_PROVIDER + MLENSIT_GROQ_API_KEY when no flags are given', () => {
    process.env['MLENSIT_AI_PROVIDER'] = 'groq';
    process.env['MLENSIT_GROQ_API_KEY'] = 'env-key';
    const plugin = resolveAiPlugin();
    expect(plugin).toBeDefined();
    expect(plugin?.name).toBe('@mlensit/ai');
  });

  it('falls back to MLENSIT_AI_PROVIDER + MLENSIT_OPENAI_API_KEY when no flags are given', () => {
    process.env['MLENSIT_AI_PROVIDER'] = 'openai';
    process.env['MLENSIT_OPENAI_API_KEY'] = 'env-key';
    expect(resolveAiPlugin()).toBeDefined();
  });

  it('falls back to MLENSIT_AI_PROVIDER + MLENSIT_GEMINI_API_KEY when no flags are given', () => {
    process.env['MLENSIT_AI_PROVIDER'] = 'gemini';
    process.env['MLENSIT_GEMINI_API_KEY'] = 'env-key';
    expect(resolveAiPlugin()).toBeDefined();
  });

  it('returns undefined when MLENSIT_AI_PROVIDER is set but the matching key is absent', () => {
    process.env['MLENSIT_AI_PROVIDER'] = 'groq';
    expect(resolveAiPlugin()).toBeUndefined();
  });

  it('CLI flags take precedence: provider flag + key flag overrides env vars', () => {
    process.env['MLENSIT_AI_PROVIDER'] = 'openai';
    process.env['MLENSIT_OPENAI_API_KEY'] = 'env-key';
    const plugin = resolveAiPlugin('groq', 'flag-key');
    expect(plugin).toBeDefined();
  });
});
