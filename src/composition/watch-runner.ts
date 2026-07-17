import { watch } from 'node:fs';
import path from 'node:path';

const IGNORED_PATH_PATTERN = /(^|\/)(node_modules|dist)\//;
const GENERATED_TEST_FILE_PATTERN = /\.generated\.test\.(ts|tsx|js|jsx)$/;

function isIgnored(relativePath: string): boolean {
  return (
    !path.extname(relativePath) ||
    IGNORED_PATH_PATTERN.test(relativePath) ||
    GENERATED_TEST_FILE_PATTERN.test(relativePath)
  );
}

/**
 * A running file watcher, returned by {@link startWatching}. Call
 * {@link Watcher.close} to stop watching and release the underlying
 * OS handle.
 */
export interface Watcher {
  close(): void;
}

/**
 * The shape of {@link startWatching}, extracted as a type so
 * `createTestCommand` can accept an injectable replacement for tests.
 */
export type StartWatching = (
  projectPath: string,
  onChange: (changedFilePaths: string[]) => void,
  debounceMs?: number,
) => Watcher;

/**
 * Starts watching `projectPath` (recursively) and invokes `onChange`
 * with the batch of project-relative file paths that changed, debounced
 * by `debounceMs` so a single save (which often fires several raw fs
 * events) triggers one rerun. Ignores `node_modules/`, `dist/`, and
 * MLensIT's own `.generated.test.<ext>` output, so a `mlensit test
 * --watch` iteration doesn't retrigger itself on the test files it just
 * wrote.
 *
 * A separate, injectable function (rather than a hardcoded `fs.watch`
 * call inline in the command) so `createTestCommand` can be exercised
 * with a fake watcher in tests without touching the real filesystem.
 */
export function startWatching(
  projectPath: string,
  onChange: (changedFilePaths: string[]) => void,
  debounceMs = 200,
): Watcher {
  let pendingChanges = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const watcher = watch(projectPath, { recursive: true }, (_eventType, filename) => {
    if (!filename) {
      return;
    }
    const relativePath = filename.split(path.sep).join('/');
    if (isIgnored(relativePath)) {
      return;
    }

    pendingChanges.add(relativePath);
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      const changed = [...pendingChanges];
      pendingChanges = new Set();
      onChange(changed);
    }, debounceMs);
  });

  return {
    close: () => {
      if (timer) {
        clearTimeout(timer);
      }
      watcher.close();
    },
  };
}
