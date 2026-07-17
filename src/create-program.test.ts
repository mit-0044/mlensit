import { ok } from '@mlensit/shared';
import { describe, expect, it } from 'vitest';
import { createProgram } from './create-program.js';
import { createFakeComposition } from './test-support/create-fake-pipeline.js';
import { createFakeLogger } from './test-support/fake-logger.js';
import packageJson from '../package.json' with { type: 'json' };

function buildComposition() {
  const logger = createFakeLogger();
  return createFakeComposition(
    {
      scannerPort: {
        scan: async () =>
          ok({
            name: 'fixture',
            version: '0.0.0',
            language: 'typescript',
            packageManager: 'npm',
            framework: 'none',
            testingFramework: 'vitest',
          }),
      },
      analysisPort: {
        analyze: async () => ok({ graph: { files: [], symbols: [], edges: [] }, diagnostics: [] }),
      },
      generationPort: { generate: async () => ok([]) },
      executionPort: { run: async () => ok([]) },
      reporterPort: { write: async () => ok(undefined) },
    },
    logger,
  );
}

describe('createProgram', () => {
  it('registers all four commands with the correct names', () => {
    const program = createProgram(buildComposition());

    const commandNames = program.commands.map((command) => command.name());

    expect(commandNames).toEqual(['analyze', 'generate', 'test', 'report']);
  });

  it('names the program mlensit and sets its version from package.json', () => {
    const program = createProgram(buildComposition());

    expect(program.name()).toBe('mlensit');
    expect(program.version()).toBe(packageJson.version);
  });

  it('accepts an optional [path] argument, defaulting to the current directory, on each command', () => {
    const program = createProgram(buildComposition());

    for (const command of program.commands) {
      const usage = command.usage();
      expect(usage).toContain('[path]');
      expect(command.registeredArguments[0]?.defaultValue).toBe('.');
    }
  });
});
