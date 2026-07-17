import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CodeGraph, CodeGraphAnalysis, ProjectMetadata } from '@mlensit/core';
import { err, ok, MLensITError } from '@mlensit/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeComposition, type FakePorts } from '../test-support/create-fake-pipeline.js';
import { createFakeLogger } from '../test-support/fake-logger.js';
import { createAnalyzeCommand } from './analyze-command.js';

const graph: CodeGraph = {
  files: [{ path: 'a.ts', symbols: [] }],
  symbols: [{ name: 'a', kind: 'function', filePath: 'a.ts', isExported: true, dependencies: [] }],
  edges: [],
};
const metadata: ProjectMetadata = {
  name: 'fixture',
  version: '0.0.0',
  language: 'typescript',
  packageManager: 'npm',
  framework: 'none',
  testingFramework: 'vitest',
};
const graphAnalysis: CodeGraphAnalysis = { graph, diagnostics: [] };

function fakePorts(overrides: Partial<FakePorts> = {}): FakePorts {
  return {
    scannerPort: { scan: async () => ok(metadata) },
    analysisPort: { analyze: async () => ok(graphAnalysis) },
    generationPort: { generate: async () => ok([]) },
    executionPort: { run: async () => ok([]) },
    reporterPort: { write: async () => ok(undefined) },
    ...overrides,
  };
}

describe('analyze command', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('prints a summary and leaves exit code unset on success', async () => {
    const logger = createFakeLogger();
    const composition = createFakeComposition(fakePorts(), logger);
    const command = createAnalyzeCommand(composition);

    await command.parseAsync(['/project'], { from: 'user' });

    expect(logger.infoMessages).toContain(
      'Analyzed 1 file(s), 1 symbol(s), 0 import edge(s), 0 call edge(s)',
    );
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
    const command = createAnalyzeCommand(composition);

    await command.parseAsync([], { from: 'user' });

    expect(scannedPath).toBe('.');
    expect(process.exitCode).toBeUndefined();
  });

  it('prints dependency-graph diagnostics found for the parsed graph as warnings', async () => {
    // The fixture graph's lone symbol 'a' is exported but unused, and its
    // file has no incoming imports edge — both trigger real diagnostics
    // from AnalyzeCodebaseUseCase's dependency-graph analysis.
    const logger = createFakeLogger();
    const composition = createFakeComposition(fakePorts(), logger);
    const command = createAnalyzeCommand(composition);

    await command.parseAsync(['/project'], { from: 'user' });

    expect(logger.warnMessages).toContain(
      "Exported symbol 'a' is not used by any other analyzed file (a.ts)",
    );
    expect(logger.warnMessages).toContain(
      'No other analyzed file imports a.ts — verify this is an intended entry point (a.ts)',
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('prints the architecture score summary', async () => {
    const logger = createFakeLogger();
    const composition = createFakeComposition(fakePorts(), logger);
    const command = createAnalyzeCommand(composition);

    await command.parseAsync(['/project'], { from: 'user' });

    // 2 warning diagnostics (unused export + dead file) -> 100 - 2*2 = 96;
    // the lone symbol has no signature, so complexity is 0.
    expect(logger.infoMessages).toContain(
      'Architecture score: 96/100 (avg. complexity 0.0, max complexity 0)',
    );
  });

  it('prints the error and sets a non-zero exit code when scanning fails', async () => {
    const failure = new MLensITError('PACKAGE_JSON_NOT_FOUND', 'no package.json found');
    const logger = createFakeLogger();
    const composition = createFakeComposition(
      fakePorts({ scannerPort: { scan: async () => err(failure) } }),
      logger,
    );
    const command = createAnalyzeCommand(composition);

    await command.parseAsync(['/project'], { from: 'user' });

    expect(logger.errorMessages).toContain('no package.json found');
    expect(process.exitCode).toBe(1);
  });

  it('prints the error and sets a non-zero exit code when parsing fails', async () => {
    const failure = new MLensITError('NOT_IMPLEMENTED', 'AST parsing is not implemented yet');
    const logger = createFakeLogger();
    const composition = createFakeComposition(
      fakePorts({ analysisPort: { analyze: async () => err(failure) } }),
      logger,
    );
    const command = createAnalyzeCommand(composition);

    await command.parseAsync(['/project'], { from: 'user' });

    expect(logger.errorMessages).toContain('AST parsing is not implemented yet');
    expect(process.exitCode).toBe(1);
  });

  describe('with --ai-provider / --ai-key flags', () => {
    const AI_ENV_VARS = ['MLENSIT_AI_PROVIDER', 'MLENSIT_GROQ_API_KEY'] as const;
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const key of AI_ENV_VARS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
    });

    afterEach(() => {
      for (const key of AI_ENV_VARS) {
        if (savedEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedEnv[key];
        }
      }
    });

    it('warns and skips AI analysis when --ai-provider is given without --ai-key', async () => {
      const logger = createFakeLogger();
      const composition = createFakeComposition(fakePorts(), logger);
      const command = createAnalyzeCommand(composition);

      await command.parseAsync(['--ai-provider', 'groq', '/project'], { from: 'user' });

      expect(logger.warnMessages.some((m) => m.includes('--ai-key'))).toBe(true);
      expect(process.exitCode).toBeUndefined();
    });

    it('accepts --ai-provider and --ai-key and succeeds (no complex candidates → no network calls)', async () => {
      const logger = createFakeLogger();
      const composition = createFakeComposition(fakePorts(), logger);
      const command = createAnalyzeCommand(composition);

      await command.parseAsync(['--ai-provider', 'groq', '--ai-key', 'test-key', '/project'], {
        from: 'user',
      });

      expect(process.exitCode).toBeUndefined();
      expect(logger.errorMessages).toHaveLength(0);
    });
  });

  describe('with a declared plugin', () => {
    let projectPath: string;

    beforeEach(async () => {
      projectPath = await mkdtemp(path.join(tmpdir(), 'mlensit-analyze-command-'));
      await writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({ name: 'fixture-project', version: '1.0.0' }),
      );
    });

    afterEach(async () => {
      await rm(projectPath, { recursive: true, force: true });
    });

    it('loads a declared plugin and includes its diagnostics in the run', async () => {
      await writeFile(
        path.join(projectPath, 'my-plugin.mjs'),
        "export default { name: 'fixture-plugin', analyze: () => [{ severity: 'warning', message: 'plugin diagnostic' }] };\n",
      );
      await writeFile(
        path.join(projectPath, 'mlensit.config.json'),
        JSON.stringify({ plugins: ['./my-plugin.mjs'] }),
      );
      const logger = createFakeLogger();
      const composition = createFakeComposition(fakePorts(), logger);
      const command = createAnalyzeCommand(composition);

      await command.parseAsync([projectPath], { from: 'user' });

      expect(logger.warnMessages).toContain('plugin diagnostic');
      expect(process.exitCode).toBeUndefined();
    });

    it('prints a warning for a declared plugin that fails to load, without aborting the run', async () => {
      await writeFile(
        path.join(projectPath, 'mlensit.config.json'),
        JSON.stringify({ plugins: ['does-not-exist'] }),
      );
      const logger = createFakeLogger();
      const composition = createFakeComposition(fakePorts(), logger);
      const command = createAnalyzeCommand(composition);

      await command.parseAsync([projectPath], { from: 'user' });

      expect(logger.warnMessages.some((message) => message.includes('does-not-exist'))).toBe(true);
      expect(process.exitCode).toBeUndefined();
    });
  });
});
