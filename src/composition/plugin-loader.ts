import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AnalyzerPlugin } from '@mlensit/core';

/**
 * The shape of `mlensit.config.json`, declared at the root of the
 * project being analyzed. `plugins` lists each plugin's module
 * specifier: a bare package name (resolved from the analyzed project's
 * own `node_modules`) or a `.`/`/`-prefixed path (resolved relative to
 * the project root). See `docs/architecture/overview.md`'s Plugin
 * Architecture section.
 */
interface PluginConfig {
  readonly plugins?: readonly string[];
}

/**
 * The result of {@link loadPlugins}: every successfully loaded
 * {@link AnalyzerPlugin} plus a human-readable warning for every
 * declared plugin that failed to resolve, load, or match the expected
 * shape. Loading never throws — a broken plugin degrades to a warning,
 * per the Plugin Architecture's isolation guarantee.
 */
export interface LoadedPlugins {
  readonly analyzerPlugins: readonly AnalyzerPlugin[];
  readonly warnings: readonly string[];
}

function isAnalyzerPluginShape(value: unknown): value is AnalyzerPlugin {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { analyze?: unknown }).analyze === 'function'
  );
}

/**
 * Resolves a declared plugin specifier to an absolute module path.
 * Bare specifiers (e.g. `"@mlensit/react"`) are resolved as a real
 * `require.resolve` would, from the *analyzed project's* own
 * `node_modules` (not this monorepo's) via a `createRequire` scoped to
 * `projectPath`. Relative specifiers (starting with `.` or `/`) are
 * resolved against `projectPath` directly.
 */
function resolveSpecifier(projectPath: string, specifier: string): string {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return path.resolve(projectPath, specifier);
  }

  const requireFromProject = createRequire(path.join(projectPath, 'package.json'));
  return requireFromProject.resolve(specifier);
}

/**
 * Reads `mlensit.config.json` from `projectPath` (its absence is not
 * an error — it simply means no plugins are declared) and loads each
 * declared plugin's default export as an {@link AnalyzerPlugin}.
 *
 * Every failure — malformed config JSON, an unresolvable specifier, a
 * module that throws on import, or an import whose default export does
 * not match the `AnalyzerPlugin` shape — is isolated as a warning
 * string rather than thrown, so one broken plugin declaration never
 * prevents the rest of the run (or the rest of the plugins) from
 * proceeding.
 */
export async function loadPlugins(projectPath: string): Promise<LoadedPlugins> {
  const configPath = path.join(projectPath, 'mlensit.config.json');

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    return { analyzerPlugins: [], warnings: [] };
  }

  let config: PluginConfig;
  try {
    config = JSON.parse(raw) as PluginConfig;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      analyzerPlugins: [],
      warnings: [`mlensit.config.json is not valid JSON: ${reason}`],
    };
  }

  const analyzerPlugins: AnalyzerPlugin[] = [];
  const warnings: string[] = [];

  for (const specifier of config.plugins ?? []) {
    try {
      const resolvedPath = resolveSpecifier(projectPath, specifier);
      const imported = (await import(pathToFileURL(resolvedPath).href)) as { default?: unknown };

      if (!isAnalyzerPluginShape(imported.default)) {
        warnings.push(
          `Plugin '${specifier}' does not export a default AnalyzerPlugin ` +
            '(expected { name: string; analyze(graph): Diagnostic[] })',
        );
        continue;
      }

      analyzerPlugins.push(imported.default);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to load plugin '${specifier}': ${reason}`);
    }
  }

  return { analyzerPlugins, warnings };
}
