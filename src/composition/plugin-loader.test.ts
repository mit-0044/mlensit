import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPlugins } from './plugin-loader.js';

let projectPath: string;

beforeEach(async () => {
  projectPath = await mkdtemp(path.join(tmpdir(), 'mlensit-plugin-loader-'));
  await writeFile(
    path.join(projectPath, 'package.json'),
    JSON.stringify({ name: 'fixture-project', version: '1.0.0' }),
  );
});

afterEach(async () => {
  await rm(projectPath, { recursive: true, force: true });
});

describe('loadPlugins', () => {
  it('returns no plugins and no warnings when mlensit.config.json does not exist', async () => {
    const result = await loadPlugins(projectPath);

    expect(result).toEqual({ analyzerPlugins: [], warnings: [] });
  });

  it('loads a real plugin module declared by a relative path', async () => {
    await writeFile(
      path.join(projectPath, 'my-plugin.mjs'),
      "export default { name: 'local-plugin', analyze: () => [{ severity: 'info', message: 'hi' }] };\n",
    );
    await writeFile(
      path.join(projectPath, 'mlensit.config.json'),
      JSON.stringify({ plugins: ['./my-plugin.mjs'] }),
    );

    const result = await loadPlugins(projectPath);

    expect(result.warnings).toEqual([]);
    expect(result.analyzerPlugins).toHaveLength(1);
    expect(result.analyzerPlugins[0]?.name).toBe('local-plugin');
    expect(result.analyzerPlugins[0]?.analyze({ files: [], symbols: [], edges: [] })).toEqual([
      { severity: 'info', message: 'hi' },
    ]);
  });

  it('loads a real plugin module declared by a bare package specifier, resolved from the project\'s own node_modules', async () => {
    const packageDirectory = path.join(projectPath, 'node_modules', 'fake-plugin');
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({ name: 'fake-plugin', version: '1.0.0', main: 'index.mjs', type: 'module' }),
    );
    await writeFile(
      path.join(packageDirectory, 'index.mjs'),
      "export default { name: 'fake-plugin', analyze: () => [] };\n",
    );
    await writeFile(
      path.join(projectPath, 'mlensit.config.json'),
      JSON.stringify({ plugins: ['fake-plugin'] }),
    );

    const result = await loadPlugins(projectPath);

    expect(result.warnings).toEqual([]);
    expect(result.analyzerPlugins).toHaveLength(1);
    expect(result.analyzerPlugins[0]?.name).toBe('fake-plugin');
  });

  it('warns instead of throwing when a declared specifier cannot be resolved', async () => {
    await writeFile(
      path.join(projectPath, 'mlensit.config.json'),
      JSON.stringify({ plugins: ['does-not-exist'] }),
    );

    const result = await loadPlugins(projectPath);

    expect(result.analyzerPlugins).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Failed to load plugin 'does-not-exist'");
  });

  it('warns instead of throwing when a plugin module does not export an AnalyzerPlugin shape', async () => {
    await writeFile(path.join(projectPath, 'bad-plugin.mjs'), 'export default { not: "a plugin" };\n');
    await writeFile(
      path.join(projectPath, 'mlensit.config.json'),
      JSON.stringify({ plugins: ['./bad-plugin.mjs'] }),
    );

    const result = await loadPlugins(projectPath);

    expect(result.analyzerPlugins).toEqual([]);
    expect(result.warnings).toEqual([
      "Plugin './bad-plugin.mjs' does not export a default AnalyzerPlugin " +
        '(expected { name: string; analyze(graph): Diagnostic[] })',
    ]);
  });

  it('warns instead of throwing when mlensit.config.json is not valid JSON', async () => {
    await writeFile(path.join(projectPath, 'mlensit.config.json'), '{ not valid json');

    const result = await loadPlugins(projectPath);

    expect(result.analyzerPlugins).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('mlensit.config.json is not valid JSON');
  });

  it('isolates one broken plugin without preventing other declared plugins from loading', async () => {
    await writeFile(
      path.join(projectPath, 'good-plugin.mjs'),
      "export default { name: 'good', analyze: () => [] };\n",
    );
    await writeFile(
      path.join(projectPath, 'mlensit.config.json'),
      JSON.stringify({ plugins: ['./good-plugin.mjs', './missing-plugin.mjs'] }),
    );

    const result = await loadPlugins(projectPath);

    expect(result.analyzerPlugins).toHaveLength(1);
    expect(result.analyzerPlugins[0]?.name).toBe('good');
    expect(result.warnings).toHaveLength(1);
  });
});
