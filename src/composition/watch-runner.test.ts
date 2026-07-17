import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startWatching, type Watcher } from './watch-runner.js';

let projectPath: string;
let watcher: Watcher | undefined;

beforeEach(async () => {
  projectPath = await mkdtemp(path.join(tmpdir(), 'mlensit-watch-runner-'));
});

afterEach(async () => {
  watcher?.close();
  watcher = undefined;
  await rm(projectPath, { recursive: true, force: true });
});

function waitForChange(timeoutMs = 2000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for a change')), timeoutMs);
    watcher = startWatching(projectPath, (changedFilePaths) => {
      clearTimeout(timeout);
      resolve(changedFilePaths);
    }, 50);
  });
}

describe('startWatching', () => {
  it('reports a changed file written after watching starts', async () => {
    const changePromise = waitForChange();
    await writeFile(path.join(projectPath, 'math.ts'), 'export const x = 1;\n');

    const changed = await changePromise;

    expect(changed).toContain('math.ts');
  });

  it('debounces multiple rapid writes into a single change batch', async () => {
    const changePromise = waitForChange();
    await writeFile(path.join(projectPath, 'a.ts'), '1');
    await writeFile(path.join(projectPath, 'a.ts'), '2');
    await writeFile(path.join(projectPath, 'a.ts'), '3');

    const changed = await changePromise;

    expect(changed).toEqual(['a.ts']);
  });

  it('ignores changes to its own .generated.test.ts output', async () => {
    let changeCount = 0;
    watcher = startWatching(
      projectPath,
      () => {
        changeCount += 1;
      },
      50,
    );

    await writeFile(path.join(projectPath, 'math.generated.test.ts'), 'it.todo("x");\n');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(changeCount).toBe(0);
  });

  it('stops reporting changes after close', async () => {
    let changeCount = 0;
    watcher = startWatching(
      projectPath,
      () => {
        changeCount += 1;
      },
      50,
    );
    watcher.close();

    await writeFile(path.join(projectPath, 'after-close.ts'), 'export {};\n');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(changeCount).toBe(0);
  });
});
