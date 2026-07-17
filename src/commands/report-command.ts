import {
  formatDashboardHtml,
  formatProgressHtml,
  startDashboardServer,
  type DashboardServer,
  type PipelineStage,
} from '@mlensit/dashboard';
import { formatConsoleReport } from '@mlensit/reporter';
import { isErr } from '@mlensit/shared';
import { Command } from 'commander';
import type { Composition } from '../composition/compose.js';
import { buildReport } from '../composition/pipeline-steps.js';
import { resolveAiPlugin } from '../composition/resolve-ai-plugin.js';

interface ReportOptions {
  readonly aiProvider?: string;
  readonly aiKey?: string;
}

/**
 * A function matching {@link startDashboardServer}'s shape, injectable
 * so tests can supply a fake server instead of binding a real port.
 */
export type StartDashboardServer = (html: string, port?: number) => Promise<DashboardServer>;

/** How long to keep the server up after a failed run, so the browser's
 * in-flight auto-refresh has a chance to load the final error page
 * before the process exits — not indefinitely, so a failed `mlensit
 * report` in a script or CI still fails promptly rather than hanging. */
const FAILURE_LINGER_MS = 1500;

/**
 * Builds the `mlensit report [path]` command. `path` defaults to `.`
 * (the current working directory). Starts a local dashboard server and
 * prints its URL immediately — before analysis even begins — serving a
 * live-progress page (`formatProgressHtml`) that updates as each
 * pipeline stage (analyze, generate, test, report) completes. Once the
 * full pipeline succeeds, the same URL swaps over to the final
 * interactive dashboard (`formatDashboardHtml`, Milestone 20) and the
 * server keeps running until interrupted (`SIGINT`, i.e. `Ctrl+C`), so
 * there is no separate `dashboard` command to run afterward. On
 * failure, the page shows an error state and the process exits
 * promptly with a non-zero exit code instead of waiting for `Ctrl+C`.
 *
 * `--ai-provider` and `--ai-key` enable AI-powered refactor suggestions
 * in the dashboard — identical to the `analyze` command's flags. The
 * resulting AI suggestions appear in the dashboard's AI Insights panel.
 * Falls back to `MLENSIT_AI_PROVIDER`/`MLENSIT_<PROVIDER>_API_KEY`
 * environment variables when neither flag is given.
 *
 * Also prints a plain-text console summary (`formatConsoleReport`) and
 * reports where the JSON/Markdown/HTML files were written (Milestone
 * 19's `FileReporter`, run as part of {@link buildReport}'s pipeline).
 *
 * `deps.startDashboardServer` defaults to the real HTTP-backed
 * {@link startDashboardServer} and exists purely so tests can inject a
 * fake server instead of binding a real port.
 */
export function createReportCommand(
  composition: Composition,
  deps: { startDashboardServer?: StartDashboardServer } = {},
): Command {
  const { logger } = composition;
  const startDashboardServerFn = deps.startDashboardServer ?? startDashboardServer;

  return new Command('report')
    .description('Run the full pipeline and serve a live-progress, interactive local dashboard')
    .argument('[path]', 'path to the project to report on', '.')
    .option('--ai-provider <provider>', 'AI provider for refactor suggestions (groq | openai | gemini)')
    .option('--ai-key <key>', 'API key for the AI provider (required when --ai-provider is set)')
    .action(async (path: string, options: ReportOptions) => {
      if (options.aiProvider && !options.aiKey) {
        logger.warn('--ai-provider requires --ai-key; skipping AI analysis');
      }

      const aiPlugin = resolveAiPlugin(options.aiProvider, options.aiKey);
      const plugins = aiPlugin ? [aiPlugin] : [];

      const completedStages: PipelineStage[] = [];
      const server = await startDashboardServerFn(formatProgressHtml(path, completedStages));

      logger.info(`Dashboard running at ${server.url} — press Ctrl+C to stop.`);

      const result = await buildReport(composition.pipeline, path, plugins, (stage) => {
        completedStages.push(stage);
        server.update(formatProgressHtml(path, completedStages));
      });

      if (isErr(result)) {
        logger.error(result.error.message);
        server.update(formatProgressHtml(path, completedStages, result.error.message));
        process.exitCode = 1;
        await new Promise((resolve) => setTimeout(resolve, FAILURE_LINGER_MS));
        await server.close();
        return;
      }

      logger.info(formatConsoleReport(result.value));
      logger.info(`Report generated at ${result.value.generatedAt.toISOString()}`);
      logger.info(`JSON/Markdown/HTML written to ${path}/.mlensit/`);
      server.update(formatDashboardHtml(result.value));

      await new Promise<void>((resolve) => {
        process.once('SIGINT', () => {
          void server.close().then(resolve);
        });
      });
    });
}
