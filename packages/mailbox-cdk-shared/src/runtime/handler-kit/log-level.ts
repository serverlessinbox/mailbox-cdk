/** The log levels from lowest to highest priority. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** How important one log call is; a call at or above the emit level is written at once, a lower one is held for a flush. */
export type LogLevel = typeof LOG_LEVELS[number];

/** Parses a log level case-insensitively and throws on any value that is not one of the four levels. */
export function parseLogLevelStrict(raw: string): LogLevel {
  if (typeof raw !== 'string') {
    throw new Error(`Invalid log level: expected string, got ${typeof raw}`);
  }

  const normalized = raw.toLowerCase();
  const level      = LOG_LEVELS.find((candidate) => candidate === normalized);
  if (level === undefined) {
    throw new Error(`Invalid log level: '${raw}' is not one of ${LOG_LEVELS.join(', ')}`);
  }

  return level;
}
