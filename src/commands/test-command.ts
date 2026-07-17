import { identifyFilesWithoutTests } from '@mlensit/core';
import { isErr } from '@mlensit/shared';
import { Command } from 'commander';
import type { Composition } from '../composition/compose.js';
import { runAffectedSuites, runSuites } from '../composition/pipeline-steps.js';
import { startWatching, type StartWatching } from '../composition/watch-runner.js';

interface TestCommandOptions {
  readonly coverage?: boolean;
  readonly watch?: boolean;
}

async function runOnceAndReport(
  composition: Composition,
  projectPath: string,
  options: TestCommandOptions,
  changedFilePaths?: string[],
): Promise<void> {
  const { logger } = composition;
  process.exitCode = undefined;

  const result = changedFilePaths
    ? await runAffectedSuites(composition.pipeline, projectPath, changedFilePaths)
    : await runSuites(composition.pipeline, projectPath);

  if (isErr(result)) {
    logger.error(result.error.message);
    process.exitCode = 1;
    return;
  }

  const totals = result.value.testResults.reduce(
    (acc, testResult) => ({
      passed: acc.passed + testResult.passed,
      failed: acc.failed + testResult.failed,
    }),
    { passed: 0, failed: 0 },
  );

  for (const testResult of result.value.testResults) {
    for (const failure of testResult.failures) {
      logger.error(`${testResult.suiteFilePath} — ${failure.testName}: ${failure.message}`);
    }
  }

  logger.info(`${totals.passed} passed, ${totals.failed} failed`);
  if (totals.failed > 0) {
    process.exitCode = 1;
  }

  if (options.coverage) {
    const coverageResult = await composition.measureCoverage.execute(projectPath);

    if (isErr(coverageResult)) {
      logger.error(coverageResult.error.message);
      process.exitCode = 1;
      return;
    }

    for (const fileCoverage of coverageResult.value) {
      logger.info(
        `${fileCoverage.filePath} — statements ${fileCoverage.statementsCoveredPercent}%, ` +
          `branches ${fileCoverage.branchesCoveredPercent}%, ` +
          `functions ${fileCoverage.functionsCoveredPercent}%, ` +
          `lines ${fileCoverage.linesCoveredPercent}%`,
      );
    }

    const filesWithoutTests = identifyFilesWithoutTests(
      result.value.analysis.graph,
      result.value.suites,
    );

    if (filesWithoutTests.length > 0) {
      logger.warn(`Files without generated tests: ${filesWithoutTests.join(', ')}`);
    }
  }
}

/**
 * Runs the pipeline once immediately, then again on every subsequent
 * file-change batch reported by `startWatchingFn` — scoped to the files
 * affected by that change (via `runAffectedSuites`) rather than a full
 * rerun. Resolves once the user stops watching (`SIGINT`, i.e.
 * `Ctrl+C`), at which point `process.exitCode` reflects the outcome of
 * the most recent run.
 */
async function runWatchMode(
  composition: Composition,
  projectPath: string,
  options: TestCommandOptions,
  startWatchingFn: StartWatching,
): Promise<void> {
  const { logger } = composition;
  logger.info(`Watching ${projectPath} for changes. Press Ctrl+C to stop.`);

  await runOnceAndReport(composition, projectPath, options);

  await new Promise<void>((resolve) => {
    const watcher = startWatchingFn(projectPath, (changedFilePaths) => {
      void runOnceAndReport(composition, projectPath, options, changedFilePaths);
    });

    process.once('SIGINT', () => {
      watcher.close();
      resolve();
    });
  });
}

/**
 * Builds the `mlensit test [path]` command. `path` defaults to `.`
 * (the current working directory). With `--coverage`, also measures
 * coverage (Milestone 12) and lists source files that have no
 * generated test suite. With `--watch` (Milestone 13), runs once, then
 * watches the project and reruns only the tests affected by each
 * subsequent change until interrupted.
 *
 * `deps.startWatching` defaults to the real filesystem-backed
 * {@link startWatching} and exists purely so tests can inject a fake
 * watcher instead of touching the real filesystem.
 */
export function createTestCommand(
  composition: Composition,
  deps: { startWatching?: StartWatching } = {},
): Command {
  const startWatchingFn = deps.startWatching ?? startWatching;

  return new Command('test')
    .description('Analyze a project, generate tests, and run them')
    .argument('[path]', 'path to the project to test', '.')
    .option('--coverage', 'measure test coverage and report files without generated tests')
    .option('--watch', 'watch the project and rerun tests affected by changed files')
    .action(async (path: string, options: TestCommandOptions) => {
      if (options.watch) {
        await runWatchMode(composition, path, options, startWatchingFn);
        return;
      }

      await runOnceAndReport(composition, path, options);
    });
}
