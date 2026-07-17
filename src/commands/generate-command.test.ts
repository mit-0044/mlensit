import type { CodeGraph, CodeGraphAnalysis, ProjectMetadata, TestSuite } from '@mlensit/core';
import { err, ok, MLensITError } from '@mlensit/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeComposition, type FakePorts } from '../test-support/create-fake-pipeline.js';
import { createFakeLogger } from '../test-support/fake-logger.js';
import { createGenerateCommand } from './generate-command.js';

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
const suites: TestSuite[] = [
  {
    filePath: 'a.generated.test.ts',
    cases: [{ name: 'a is defined', targetSymbol: 'a', body: '  it.todo("a is defined");' }],
  },
];

function fakePorts(overrides: Partial<FakePorts> = {}): FakePorts {
  return {
    scannerPort: { scan: async () => ok(metadata) },
    analysisPort: { analyze: async () => ok(graphAnalysis) },
    generationPort: { generate: async () => ok(suites) },
    executionPort: { run: async () => ok([]) },
    reporterPort: { write: async () => ok(undefined) },
    ...overrides,
  };
}

describe('generate command', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('prints the number of generated suites on success', async () => {
    const logger = createFakeLogger();
    const composition = createFakeComposition(fakePorts(), logger);
    const command = createGenerateCommand(composition);

    await command.parseAsync(['/project'], { from: 'user' });

    expect(logger.infoMessages).toContain('Generated 1 test suite(s), 1 test case(s)');
    expect(logger.infoMessages).toContain('  a.generated.test.ts: 1 case(s)');
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
    const command = createGenerateCommand(composition);

    await command.parseAsync([], { from: 'user' });

    expect(scannedPath).toBe('.');
  });

  it('surfaces an upstream analysis failure and sets a non-zero exit code', async () => {
    const failure = new MLensITError('NOT_IMPLEMENTED', 'AST parsing is not implemented yet');
    const logger = createFakeLogger();
    const composition = createFakeComposition(
      fakePorts({ analysisPort: { analyze: async () => err(failure) } }),
      logger,
    );
    const command = createGenerateCommand(composition);

    await command.parseAsync(['/project'], { from: 'user' });

    expect(logger.errorMessages).toContain('AST parsing is not implemented yet');
    expect(process.exitCode).toBe(1);
  });
});
