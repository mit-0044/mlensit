import { Command } from 'commander';
import { createAnalyzeCommand } from './commands/analyze-command.js';
import { createGenerateCommand } from './commands/generate-command.js';
import { createReportCommand } from './commands/report-command.js';
import { createTestCommand } from './commands/test-command.js';
import type { Composition } from './composition/compose.js';
import packageJson from '../package.json' with { type: 'json' };

/**
 * Builds the `mlensit` Commander program with all four commands
 * registered against the given {@link Composition}, without parsing
 * `process.argv`. Kept separate from `index.ts` so it can be exercised
 * directly in tests. The version is read from `package.json` at build
 * time (bundled in as a static value, not read from disk at runtime)
 * so `mlensit --version` can never drift from the published version.
 *
 * There is no standalone `dashboard` command: `mlensit report` starts
 * the dashboard server itself, serving live progress and then the
 * final interactive dashboard from the same URL — see
 * `commands/report-command.ts`.
 */
export function createProgram(composition: Composition): Command {
  const program = new Command();
  program
    .name('mlensit')
    .description('Offline Static Code Intelligence Platform')
    .version(packageJson.version);

  program.addCommand(createAnalyzeCommand(composition));
  program.addCommand(createGenerateCommand(composition));
  program.addCommand(createTestCommand(composition));
  program.addCommand(createReportCommand(composition));

  return program;
}
