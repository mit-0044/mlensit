import { isErr } from '@mlensit/shared';
import { Command } from 'commander';
import type { Composition } from '../composition/compose.js';
import { generateSuites } from '../composition/pipeline-steps.js';

/**
 * Builds the `mlensit generate [path]` command. `path` defaults to
 * `.` (the current working directory).
 */
export function createGenerateCommand(composition: Composition): Command {
  const { logger } = composition;

  return new Command('generate')
    .description('Analyze a project and generate tests for it')
    .argument('[path]', 'path to the project to generate tests for', '.')
    .action(async (path: string) => {
      const result = await generateSuites(composition.pipeline, path);

      if (isErr(result)) {
        logger.error(result.error.message);
        process.exitCode = 1;
        return;
      }

      const { suites } = result.value;
      const totalCases = suites.reduce((total, suite) => total + suite.cases.length, 0);
      logger.info(`Generated ${suites.length} test suite(s), ${totalCases} test case(s)`);

      for (const suite of suites) {
        logger.info(`  ${suite.filePath}: ${suite.cases.length} case(s)`);
      }
    });
}
