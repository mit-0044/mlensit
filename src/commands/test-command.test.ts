import type {
  CodeGraph,
  CodeGraphAnalysis,
  ProjectMetadata,
  TestResult,
  TestSuite,
} from '@mlensit/core';
import { err, ok, MLensITError } from '@mlensit/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StartWatching } from '../composition/watch-runner.js';
import { createFakeComposition, type FakePorts } from '../test-support/create-fake-pipeline.js';
import { createFakeLogger } from '../test-support/fake-logger.js';
import { createTestCommand } from './test-command.js';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const graph: CodeGraph = { files: [], symbols: [], edges: [] };
const metadata: ProjectMetadata = {
  name: 'fixture',
  version: '0.0.0',
  language: 'typescript',
  packageManager: 'npm',
  framework: 'none',
  testingFramework: 'vitest',
};
const graphAnalysis: CodeGraphAnalysis = { graph, diagnostics: [] };
const suites: TestSuite[] = [{ filePath: 'a.test.ts', cases: [] }];

const coverageGraph: CodeGraph = {
  files: [
    { path: 'src/covered.ts', symbols: [] },
    { path: 'src/uncovered.ts', symbols: [] },
  ],
  symbols: [],
  edges: [],
};
const coverageGraphAnalysis: CodeGraphAnalysis = { graph: coverageGraph, diagnostics: [] };
const coverageSuites: TestSuite[] = [{ filePath: 'src/covered.generated.test.ts', cases: [] }];

const watchGraph: CodeGraph = {
  files: [],
  symbols: [],
  edges: [{ from: 'dependent.ts', to: 'changed.ts', kind: 'imports' }],
};
const watchGraphAnalysis: CodeGraphAnalysis = { graph: watchGraph, diagnostics: [] };
const watchSuites: TestSuite[] = [
  { filePath: 'changed.generated.test.ts', cases: [] },
  { filePath: 'dependent.generated.test.ts', cases: [] },
  { filePath: 'unrelated.generated.test.ts', cases: [] },
];

function fakePorts(overrides: Partial<FakePorts> = {}): FakePorts {
  return {
    scannerPort: { scan: async () => ok(metadata) },
    analysisPort: { analyze: async () => ok(graphAnalysis) },
    generationPort: { generate: async () => ok(suites) },
    executionPort: { run: async () => ok<TestResult[]>([]) },
    reporterPort: { write: async () => ok(undefined) },
    ...overrides,
  };
}

describe('test command', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('reports totals and leaves exit code unset when everything passes', async () => {
    const results: TestResult[] = [
      { suiteFilePath: 'a.test.ts', passed: 2, failed: 0, failures: [] },
    ];
    const logger = createFakeLogger();
    const composition = createFakeComposition(
      fakePorts({ executionPort: { run: async () => ok(results) } }),
      logger,
    );
    const command = createTestCommand(composition);

    await command.parseAsync(['/project'], { from: 'user' });

    expect(logger.infoMessages).toContain('2 passed, 0 failed');
    expect(process.exitCode).toBeUndefined();
  });

  it('defaults to the current directory when no path is given', async () => {
    let scannedPath: string | undefined;
    const logger = createFakeLogger();
    const composition = createFakeComposition(
      fakePorts({
        scannerPort: {
          scan: async (projectPath) => {
            scannedPath = projectPath;
            return ok(metadata);
          },
        },
      }),
      logger,
    );
    const command = createTestCommand(composition);

    await command.parseAsync([], { from: 'user' });

    expect(scannedPath).toBe('.');
  });

  it('sets a non-zero exit code when a test fails', async () => {
    const results: TestResult[] = [
      { suiteFilePath: 'a.test.ts', passed: 1, failed: 1, failures: [{ testName: 'x', message: 'nope' }] },
    ];
    const logger = createFakeLogger();
    const composition = createFakeComposition(
      fakePorts({ executionPort: { run: async () => ok(results) } }),
      logger,
    );
    const command = createTestCommand(composition);

    await command.parseAsync(['/project'], { from: 'user' });

    expect(logger.infoMessages).toContain('1 passed, 1 failed');
    expect(logger.errorMessages).toContain('a.test.ts — x: nope');
    expect(process.exitCode).toBe(1);
  });

  it('surfaces an upstream failure and sets a non-zero exit code', async () => {
    const failure = new MLensITError('NOT_IMPLEMENTED', 'test execution is not implemented yet');
    const logger = createFakeLogger();
    const composition = createFakeComposition(
      fakePorts({ executionPort: { run: async () => err(failure) } }),
      logger,
    );
    const command = createTestCommand(composition);

    await command.parseAsync(['/project'], { from: 'user' });

    expect(logger.errorMessages).toContain('test execution is not implemented yet');
    expect(process.exitCode).toBe(1);
  });

  it('with --coverage, reports per-file coverage and files without generated tests', async () => {
    const logger = createFakeLogger();
    const composition = createFakeComposition(
      fakePorts({
        analysisPort: { analyze: async () => ok(coverageGraphAnalysis) },
        generationPort: { generate: async () => ok(coverageSuites) },
        coveragePort: {
          measure: async () =>
            ok([
              {
                filePath: 'src/covered.ts',
                statementsCoveredPercent: 80,
                branchesCoveredPercent: 70,
                functionsCoveredPercent: 90,
                linesCoveredPercent: 85,
              },
            ]),
        },
      }),
      logger,
    );
    const command = createTestCommand(composition);

    await command.parseAsync(['/project', '--coverage'], { from: 'user' });

    expect(logger.infoMessages).toContain(
      'src/covered.ts — statements 80%, branches 70%, functions 90%, lines 85%',
    );
    expect(logger.warnMessages).toContain('Files without generated tests: src/uncovered.ts');
    expect(process.exitCode).toBeUndefined();
  });

  it('with --coverage, surfaces a coverage-measurement failure and sets a non-zero exit code', async () => {
    const failure = new MLensITError(
      'COVERAGE_MEASUREMENT_FAILED',
      'vitest did not produce a coverage-summary.json',
    );
    const logger = createFakeLogger();
    const composition = createFakeComposition(
      fakePorts({
        coveragePort: { measure: async () => err(failure) },
      }),
      logger,
    );
    const command = createTestCommand(composition);

    await command.parseAsync(['/project', '--coverage'], { from: 'user' });

    expect(logger.errorMessages).toContain('vitest did not produce a coverage-summary.json');
    expect(process.exitCode).toBe(1);
  });

  it('without --coverage, does not measure coverage', async () => {
    const logger = createFakeLogger();
    let measureCalled = false;
    const composition = createFakeComposition(
      fakePorts({
        coveragePort: {
          measure: async () => {
            measureCalled = true;
            return ok([]);
          },
        },
      }),
      logger,
    );
    const command = createTestCommand(composition);

    await command.parseAsync(['/project'], { from: 'user' });

    expect(measureCalled).toBe(false);
  });

  it('with --watch, runs once immediately, then reruns only affected suites on a change, and stops on SIGINT', async () => {
    const logger = createFakeLogger();
    const suitesPassedPerRun: string[][] = [];
    const composition = createFakeComposition(
      fakePorts({
        analysisPort: { analyze: async () => ok(watchGraphAnalysis) },
        generationPort: { generate: async () => ok(watchSuites) },
        executionPort: {
          run: async (suitesArg) => {
            suitesPassedPerRun.push(suitesArg.map((suite) => suite.filePath).sort());
            return ok<TestResult[]>([]);
          },
        },
      }),
      logger,
    );

    let capturedOnChange: ((changedFilePaths: string[]) => void) | undefined;
    let closeCalled = false;
    const fakeStartWatching: StartWatching = (_projectPath, onChange) => {
      capturedOnChange = onChange;
      return {
        close: () => {
          closeCalled = true;
        },
      };
    };

    const command = createTestCommand(composition, { startWatching: fakeStartWatching });
    const runPromise = command.parseAsync(['/project', '--watch'], { from: 'user' });

    await flushMicrotasks();
    expect(capturedOnChange).toBeDefined();
    expect(suitesPassedPerRun).toEqual([
      ['changed.generated.test.ts', 'dependent.generated.test.ts', 'unrelated.generated.test.ts'],
    ]);
    expect(logger.infoMessages).toContain('Watching /project for changes. Press Ctrl+C to stop.');

    capturedOnChange!(['changed.ts']);
    await flushMicrotasks();

    expect(suitesPassedPerRun).toEqual([
      ['changed.generated.test.ts', 'dependent.generated.test.ts', 'unrelated.generated.test.ts'],
      ['changed.generated.test.ts', 'dependent.generated.test.ts'],
    ]);

    process.emit('SIGINT');
    await runPromise;

    expect(closeCalled).toBe(true);
  });
});
