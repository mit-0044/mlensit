import type {
  AnalysisResult,
  AnalyzerPlugin,
  CodeGraph,
  CodeGraphAnalysis,
  ProjectMetadata,
  TestResult,
  TestSuite,
} from '@mlensit/core';
import { err, ok, MLensITError } from '@mlensit/shared';
import { describe, expect, it } from 'vitest';
import { createFakeLogger } from '../test-support/fake-logger.js';
import { createFakePipeline, type FakePorts } from '../test-support/create-fake-pipeline.js';
import {
  analyzeProject,
  buildReport,
  generateSuites,
  runAffectedSuites,
  runSuites,
} from './pipeline-steps.js';

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
const analysis: AnalysisResult = {
  metadata,
  graph,
  diagnostics: [],
  architectureScore: {
    overall: 100,
    totalFiles: 0,
    totalSymbols: 0,
    errorCount: 0,
    warningCount: 0,
    averageCyclomaticComplexity: 0,
    maxCyclomaticComplexity: 0,
  },
};
const suites: TestSuite[] = [{ filePath: 'a.test.ts', cases: [] }];
const testResults: TestResult[] = [
  { suiteFilePath: 'a.test.ts', passed: 1, failed: 0, failures: [] },
];

function fakePorts(overrides: Partial<FakePorts> = {}): FakePorts {
  return {
    scannerPort: { scan: async () => ok(metadata) },
    analysisPort: { analyze: async () => ok(graphAnalysis) },
    generationPort: { generate: async () => ok(suites) },
    executionPort: { run: async () => ok(testResults) },
    reporterPort: { write: async () => ok(undefined) },
    ...overrides,
  };
}

describe('analyzeProject', () => {
  it('delegates to the analyze use case', async () => {
    const pipeline = createFakePipeline(fakePorts(), createFakeLogger());

    const result = await analyzeProject(pipeline, '/project');

    expect(result).toEqual(ok(analysis));
  });

  it('forwards injected plugins to the analyze use case, contributing their diagnostics', async () => {
    const pipeline = createFakePipeline(fakePorts(), createFakeLogger());
    const plugin: AnalyzerPlugin = {
      name: 'fixture-plugin',
      analyze: () => [{ severity: 'warning', message: 'from plugin' }],
    };

    const result = await analyzeProject(pipeline, '/project', [plugin]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.diagnostics).toEqual([{ severity: 'warning', message: 'from plugin' }]);
    }
  });
});

describe('generateSuites', () => {
  it('chains analyze then generate on success', async () => {
    const pipeline = createFakePipeline(fakePorts(), createFakeLogger());

    const result = await generateSuites(pipeline, '/project');

    expect(result).toEqual(ok({ analysis, suites }));
  });

  it('forwards plugins to the analysis stage, contributing their diagnostics', async () => {
    const plugin: AnalyzerPlugin = {
      name: 'fixture-plugin',
      analyze: () => [{ severity: 'info', message: 'from plugin' }],
    };
    const pipeline = createFakePipeline(fakePorts(), createFakeLogger());

    const result = await generateSuites(pipeline, '/project', [plugin]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.analysis.diagnostics).toContainEqual({
        severity: 'info',
        message: 'from plugin',
      });
    }
  });

  it('short-circuits when analysis fails, without calling generate', async () => {
    const failure = new MLensITError('ANALYSIS_FAILED', 'boom');
    let generateCalled = false;
    const pipeline = createFakePipeline(
      fakePorts({
        analysisPort: { analyze: async () => err(failure) },
        generationPort: {
          generate: async () => {
            generateCalled = true;
            return ok(suites);
          },
        },
      }),
      createFakeLogger(),
    );

    const result = await generateSuites(pipeline, '/project');

    expect(result).toEqual(err(failure));
    expect(generateCalled).toBe(false);
  });
});

describe('runSuites', () => {
  it('chains analyze, generate, then run on success', async () => {
    const pipeline = createFakePipeline(fakePorts(), createFakeLogger());

    const result = await runSuites(pipeline, '/project');

    expect(result).toEqual(ok({ analysis, suites, testResults }));
  });

  it('short-circuits when generation fails, without calling run', async () => {
    const failure = new MLensITError('GENERATION_FAILED', 'boom');
    let runCalled = false;
    const pipeline = createFakePipeline(
      fakePorts({
        generationPort: { generate: async () => err(failure) },
        executionPort: {
          run: async () => {
            runCalled = true;
            return ok(testResults);
          },
        },
      }),
      createFakeLogger(),
    );

    const result = await runSuites(pipeline, '/project');

    expect(result).toEqual(err(failure));
    expect(runCalled).toBe(false);
  });
});

describe('runAffectedSuites', () => {
  const affectedGraph: CodeGraph = {
    files: [],
    symbols: [],
    edges: [{ from: 'dependent.ts', to: 'changed.ts', kind: 'imports' }],
  };
  const affectedGraphAnalysis: CodeGraphAnalysis = { graph: affectedGraph, diagnostics: [] };
  const affectedSuites: TestSuite[] = [
    { filePath: 'changed.generated.test.ts', cases: [] },
    { filePath: 'dependent.generated.test.ts', cases: [] },
    { filePath: 'unrelated.generated.test.ts', cases: [] },
  ];

  it('runs only suites affected by the changed files, transitively through imports', async () => {
    let suitesPassedToRun: TestSuite[] | undefined;
    const pipeline = createFakePipeline(
      fakePorts({
        analysisPort: { analyze: async () => ok(affectedGraphAnalysis) },
        generationPort: { generate: async () => ok(affectedSuites) },
        executionPort: {
          run: async (suitesArg) => {
            suitesPassedToRun = suitesArg;
            return ok([]);
          },
        },
      }),
      createFakeLogger(),
    );

    const result = await runAffectedSuites(pipeline, '/project', ['changed.ts']);

    expect(suitesPassedToRun?.map((suite) => suite.filePath).sort()).toEqual([
      'changed.generated.test.ts',
      'dependent.generated.test.ts',
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suites.map((suite) => suite.filePath).sort()).toEqual([
        'changed.generated.test.ts',
        'dependent.generated.test.ts',
      ]);
    }
  });

  it('short-circuits when generation fails, without calling run', async () => {
    const failure = new MLensITError('GENERATION_FAILED', 'boom');
    let runCalled = false;
    const pipeline = createFakePipeline(
      fakePorts({
        generationPort: { generate: async () => err(failure) },
        executionPort: {
          run: async () => {
            runCalled = true;
            return ok(testResults);
          },
        },
      }),
      createFakeLogger(),
    );

    const result = await runAffectedSuites(pipeline, '/project', ['changed.ts']);

    expect(result).toEqual(err(failure));
    expect(runCalled).toBe(false);
  });
});

describe('buildReport', () => {
  it('forwards plugins through the full pipeline to the analysis stage', async () => {
    const plugin: AnalyzerPlugin = {
      name: 'fixture-plugin',
      analyze: () => [{ severity: 'info', message: 'from plugin' }],
    };
    const pipeline = createFakePipeline(fakePorts(), createFakeLogger());

    const result = await buildReport(pipeline, '/project', [plugin]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.analysis.diagnostics).toContainEqual({
        severity: 'info',
        message: 'from plugin',
      });
    }
  });

  it('chains the full pipeline and writes the report on success', async () => {
    let writtenProjectPath: string | undefined;
    const pipeline = createFakePipeline(
      fakePorts({
        reporterPort: {
          write: async (_report, projectPath) => {
            writtenProjectPath = projectPath;
            return ok(undefined);
          },
        },
      }),
      createFakeLogger(),
    );

    const result = await buildReport(pipeline, '/project');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.analysis).toEqual(analysis);
      expect(result.value.testResults).toEqual(testResults);
    }
    expect(writtenProjectPath).toBe('/project');
  });

  it('short-circuits when test execution fails, without writing a report', async () => {
    const failure = new MLensITError('EXECUTION_FAILED', 'boom');
    let writeCalled = false;
    const pipeline = createFakePipeline(
      fakePorts({
        executionPort: { run: async () => err(failure) },
        reporterPort: {
          write: async () => {
            writeCalled = true;
            return ok(undefined);
          },
        },
      }),
      createFakeLogger(),
    );

    const result = await buildReport(pipeline, '/project');

    expect(result).toEqual(err(failure));
    expect(writeCalled).toBe(false);
  });

  it('surfaces a failure from writing the report itself', async () => {
    const failure = new MLensITError('REPORT_FAILED', 'disk full');
    const pipeline = createFakePipeline(
      fakePorts({ reporterPort: { write: async () => err(failure) } }),
      createFakeLogger(),
    );

    const result = await buildReport(pipeline, '/project');

    expect(result).toEqual(err(failure));
  });
});
