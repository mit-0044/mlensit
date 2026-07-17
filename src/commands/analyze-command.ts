import type { Diagnostic } from '@mlensit/core';
import { isErr } from '@mlensit/shared';
import { Command } from 'commander';
import type { Composition } from '../composition/compose.js';
import { loadPlugins } from '../composition/plugin-loader.js';
import { resolveAiPlugin } from '../composition/resolve-ai-plugin.js';

interface AnalyzeOptions {
  readonly aiProvider?: string;
  readonly aiKey?: string;
}

function logDiagnostic(diagnostic: Diagnostic, logger: Composition['logger']): void {
  const location = diagnostic.filePath ? ` (${diagnostic.filePath})` : '';
  const message = `${diagnostic.message}${location}`;

  if (diagnostic.severity === 'error') {
    logger.error(message);
  } else {
    logger.warn(message);
  }
}

/**
 * Builds the `mlensit analyze [path]` command. `path` defaults to `.`
 * (the current working directory), so running `mlensit analyze` from a
 * project's root analyzes that project without an explicit argument.
 *
 * `--ai-provider` and `--ai-key` enable AI-powered refactor suggestions
 * directly from the CLI, injecting the `@mlensit/ai` plugin without
 * requiring it to be declared in the project's `mlensit.config.json`. When
 * neither flag is given, `MLENSIT_AI_PROVIDER` and the matching
 * `MLENSIT_<PROVIDER>_API_KEY` environment variables are checked as a
 * fallback so the usual env-var workflow still works.
 */
export function createAnalyzeCommand({ pipeline, logger }: Composition): Command {
  return new Command('analyze')
    .description('Statically analyze a TypeScript/JavaScript project')
    .argument('[path]', 'path to the project to analyze', '.')
    .option('--ai-provider <provider>', 'AI provider for refactor suggestions (groq | openai | gemini)')
    .option('--ai-key <key>', 'API key for the AI provider (required when --ai-provider is set)')
    .action(async (path: string, options: AnalyzeOptions) => {
      if (options.aiProvider && !options.aiKey) {
        logger.warn('--ai-provider requires --ai-key; skipping AI analysis');
      }

      const { analyzerPlugins, warnings } = await loadPlugins(path);
      for (const warning of warnings) {
        logger.warn(warning);
      }

      const aiPlugin = resolveAiPlugin(options.aiProvider, options.aiKey);
      const allPlugins = aiPlugin ? [...analyzerPlugins, aiPlugin] : analyzerPlugins;

      const result = await pipeline.analyzeCodebase.execute(path, allPlugins);

      if (isErr(result)) {
        logger.error(result.error.message);
        process.exitCode = 1;
        return;
      }

      const { graph, diagnostics, architectureScore } = result.value;
      const importEdgeCount = graph.edges.filter((edge) => edge.kind === 'imports').length;
      const callEdgeCount = graph.edges.filter((edge) => edge.kind === 'calls').length;
      logger.info(
        `Analyzed ${graph.files.length} file(s), ${graph.symbols.length} symbol(s), ` +
          `${importEdgeCount} import edge(s), ${callEdgeCount} call edge(s)`,
      );
      logger.info(
        `Architecture score: ${architectureScore.overall}/100 ` +
          `(avg. complexity ${architectureScore.averageCyclomaticComplexity.toFixed(1)}, ` +
          `max complexity ${architectureScore.maxCyclomaticComplexity})`,
      );

      for (const diagnostic of diagnostics) {
        logDiagnostic(diagnostic, logger);
      }
    });
}
