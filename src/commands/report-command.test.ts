import type {
  CodeGraph,
  CodeGraphAnalysis,
  ProjectMetadata,
  TestResult,
  TestSuite,
} from '@mlensit/core';
import type { DashboardServer } from '@mlensit/dashboard';
import { err, ok, MLensITError } from '@mlensit/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeComposition, type FakePorts } from '../test-support/create-fake-pipeline.js';
import { createFakeLogger } from '../test-support/fake-logger.js';
import { createReportCommand, type StartDashboardServer } from './report-command.js';

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
const results: TestResult[] = [{ suiteFilePath: 'a.test.ts', passed: 1, failed: 0, failures: [] }];

function fakePorts(overrides: Partial<FakePorts> = {}): FakePorts {
  return {
    scannerPort: { scan: async () => ok(metadata) },
    analysisPort: { analyze: async () => ok(graphAnalysis) },
    generationPort: { generate: async () => ok(suites) },
    executionPort: { run: async () => ok(results) },
    reporterPort: { write: async () => ok(undefined) },
    ...overrides,
  };
}

function fakeServer(updates: string[]): { fn: StartDashboardServer; closed: () => boolean } {
  let closed = false;
  const fn: StartDashboardServer = async (html) => {
    updates.push(html);
    const server: DashboardServer = {
      url: 'http://127.0.0.1:12345',
      update: (html) => updates.push(html),
      close: async () => {
        closed = true;
      },
    };
    return server;
  };
  return { fn, closed: () => closed };
}

describe('report command', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('starts the dashboard server and prints its URL before the pipeline runs', async () => {
    const updates: string[] = [];
    const { fn } = fakeServer(updates);
    const logger = createFakeLogger();
    const composition = createFakeComposition(fakePorts(), logger);
    const command = createReportCommand(composition, { startDashboardServer: fn });

    const runPromise = command.parseAsync(['/project'], { from: 'user' });
    await flushMicrotasks();

    expect(logger.infoMessages.some((message) => message.includes('http://127.0.0.1:12345'))).toBe(
      true,
    );
    expect(updates[0]).toContain('<!doctype html>');
    expect(updates[0]).not.toContain('MLensIT Dashboard');

    process.emit('SIGINT');
    await runPromise;
  });

  it('updates the served page once per pipeline stage, then serves the final dashboard', async () => {
    const updates: string[] = [];
    const { fn } = fakeServer(updates);
    const logger = createFakeLogger();
    const composition = createFakeComposition(fakePorts(), logger);
    const command = createReportCommand(composition, { startDashboardServer: fn });

    const runPromise = command.parseAsync(['/project'], { from: 'user' });
    await flushMicrotasks();

    // initial progress page + one update per stage (analyze, generate, test, report) + final dashboard
    expect(updates).toHaveLength(6);
    expect(updates[updates.length - 1]).toContain('MLensIT Dashboard');
    expect(process.exitCode).toBeUndefined();

    process.emit('SIGINT');
    await runPromise;
  });

  it('closes the server and resolves once SIGINT is received', async () => {
    const updates: string[] = [];
    const { fn, closed } = fakeServer(updates);
    const logger = createFakeLogger();
    const composition = createFakeComposition(fakePorts(), logger);
    const command = createReportCommand(composition, { startDashboardServer: fn });

    const runPromise = command.parseAsync(['/project'], { from: 'user' });
    await flushMicrotasks();

    process.emit('SIGINT');
    await runPromise;

    expect(closed()).toBe(true);
  });

  it('prints the console report, timestamp, and output location on success', async () => {
    const updates: string[] = [];
    const { fn } = fakeServer(updates);
    const logger = createFakeLogger();
    const composition = createFakeComposition(fakePorts(), logger);
    const command = createReportCommand(composition, { startDashboardServer: fn });

    const runPromise = command.parseAsync(['/project'], { from: 'user' });
    await flushMicrotasks();

    expect(logger.infoMessages.some((message) => message.includes('architecture score'))).toBe(
      true,
    );
    expect(logger.infoMessages.some((message) => message.startsWith('Report generated at'))).toBe(
      true,
    );
    expect(logger.infoMessages).toContain('JSON/Markdown/HTML written to /project/.mlensit/');

    process.emit('SIGINT');
    await runPromise;
  });

  it('defaults to the current directory when no path is given', async () => {
    let scannedPath: string | undefined;
    const updates: string[] = [];
    const { fn } = fakeServer(updates);
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
    const command = createReportCommand(composition, { startDashboardServer: fn });

    const runPromise = command.parseAsync([], { from: 'user' });
    await flushMicrotasks();

    expect(scannedPath).toBe('.');
    expect(logger.infoMessages).toContain('JSON/Markdown/HTML written to ./.mlensit/');

    process.emit('SIGINT');
    await runPromise;
  });

  describe('with --ai-provider / --ai-key flags', () => {
    it('warns and skips AI analysis when --ai-provider is given without --ai-key', async () => {
      const updates: string[] = [];
      const { fn } = fakeServer(updates);
      const logger = createFakeLogger();
      const composition = createFakeComposition(fakePorts(), logger);
      const command = createReportCommand(composition, { startDashboardServer: fn });

      const runPromise = command.parseAsync(['--ai-provider', 'groq', '/project'], { from: 'user' });
      await flushMicrotasks();

      expect(logger.warnMessages.some((m) => m.includes('--ai-key'))).toBe(true);

      process.emit('SIGINT');
      await runPromise;
    });

    it('accepts --ai-provider and --ai-key and succeeds (no complex candidates → no network calls)', async () => {
      const updates: string[] = [];
      const { fn } = fakeServer(updates);
      const logger = createFakeLogger();
      const composition = createFakeComposition(fakePorts(), logger);
      const command = createReportCommand(composition, { startDashboardServer: fn });

      const runPromise = command.parseAsync(
        ['--ai-provider', 'groq', '--ai-key', 'test-key', '/project'],
        { from: 'user' },
      );
      await flushMicrotasks();

      expect(process.exitCode).toBeUndefined();
      expect(logger.errorMessages).toHaveLength(0);

      process.emit('SIGINT');
      await runPromise;
    });
  });

  it('on failure, shows the error in the dashboard, sets a non-zero exit code, and closes without waiting for SIGINT', async () => {
    vi.useFakeTimers();
    try {
      const failure = new MLensITError(
        'REPORT_WRITE_FAILED',
        'could not write report to /project/.mlensit',
      );
      const updates: string[] = [];
      const { fn, closed } = fakeServer(updates);
      const logger = createFakeLogger();
      const composition = createFakeComposition(
        fakePorts({ reporterPort: { write: async () => err(failure) } }),
        logger,
      );
      const command = createReportCommand(composition, { startDashboardServer: fn });

      const runPromise = command.parseAsync(['/project'], { from: 'user' });
      await vi.advanceTimersByTimeAsync(2000);
      await runPromise;

      expect(logger.errorMessages).toContain('could not write report to /project/.mlensit');
      expect(process.exitCode).toBe(1);
      expect(updates[updates.length - 1]).toContain('could not write report to /project/.mlensit');
      expect(closed()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
