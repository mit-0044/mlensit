import type { Logger } from '@mlensit/shared';

/**
 * A {@link Logger} test double that records every call instead of writing
 * anywhere, so CLI tests can assert on user-facing output without
 * touching stdout.
 */
export interface FakeLogger extends Logger {
  readonly infoMessages: string[];
  readonly warnMessages: string[];
  readonly errorMessages: string[];
}

/**
 * Creates a {@link FakeLogger} for use in tests.
 */
export function createFakeLogger(): FakeLogger {
  const infoMessages: string[] = [];
  const warnMessages: string[] = [];
  const errorMessages: string[] = [];

  return {
    infoMessages,
    warnMessages,
    errorMessages,
    info: (message: string) => {
      infoMessages.push(message);
    },
    warn: (message: string) => {
      warnMessages.push(message);
    },
    error: (message: string) => {
      errorMessages.push(message);
    },
  };
}
