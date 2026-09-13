/**
 * Buffered logger for artifact-updater Lambda.
 *
 * Implements level-based filtering matching Go's logging.BufferedHandler:
 * - Entries at or above emitLevel are written to console immediately.
 * - Entries below emitLevel are buffered in memory.
 * - Flushing emits only buffered (suppressed) entries, not already-emitted ones.
 *
 * With the default emitLevel='error':
 * - error() writes to console immediately.
 * - warn/info/debug are buffered and discarded unless flushed (typically on error).
 * - Silent on no-op runs (no updates, no errors) to reduce CloudWatch noise.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * The ordered levels from lowest to highest priority.
 * Used by the level comparison logic and the strict parser.
 */
const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

/**
 * Parse a log level string strictly.
 * Accepts 'debug', 'info', 'warn', 'error' case-insensitively.
 * Throws on an unrecognised value.
 */
export function parseLogLevelStrict(raw: string): LogLevel {
  if (typeof raw !== 'string') {
    throw new Error(`Invalid log level: expected string, got ${typeof raw}`);
  }
  const normalized = raw.toLowerCase();
  if (!LEVELS.includes(normalized as LogLevel)) {
    throw new Error(`Invalid log level: '${raw}' is not one of ${LEVELS.join(', ')}`);
  }
  return normalized as LogLevel;
}

export class LoggerBuffer {
  private entries: LogEntry[] = [];
  private updateCount: number = 0;
  private errorCount: number = 0;
  private service?: string;
  private emitLevel: LogLevel;

  constructor(service?: string, level?: LogLevel) {
    this.service = service;
    this.emitLevel = level ?? 'error';
  }

  /**
   * Compare two log levels.
   * Returns true if levelA >= levelB in priority.
   */
  private isAtOrAboveLevel(levelA: LogLevel, levelB: LogLevel): boolean {
    const indexA = LEVELS.indexOf(levelA);
    const indexB = LEVELS.indexOf(levelB);
    return indexA >= indexB;
  }

  /**
   * Record a debug log (high-volume, typically skipped info).
   * Emitted immediately if emitLevel is 'debug', otherwise buffered.
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  /**
   * Record an info log (business state changes, updates).
   * Emitted immediately if emitLevel is 'debug' or 'info', otherwise buffered.
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  /**
   * Record a warning log.
   * Emitted immediately if emitLevel is 'debug', 'info', or 'warn', otherwise buffered.
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  /**
   * Record an error log and increment error counter.
   * Always emitted immediately (error >= all emitLevels).
   * Error count is incremented for shouldFlush() even though the entry is not buffered.
   */
  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
    this.errorCount++;
  }

  /**
   * Internal method to handle both immediate and buffered emission.
   */
  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const attachedData = this.attachService(data);
    const entry: LogEntry = { level, message, data: attachedData };

    if (this.isAtOrAboveLevel(level, this.emitLevel)) {
      // Emit immediately, do not buffer.
      this.emitEntry(entry);
    } else {
      // Below emit level: buffer only.
      this.entries.push(entry);
    }
  }

  /**
   * Emit a single entry to the console.
   */
  private emitEntry(entry: LogEntry): void {
    const consoleMethod = console[entry.level] || console.log;
    if (entry.data) {
      consoleMethod(entry.message, entry.data);
    } else {
      consoleMethod(entry.message);
    }
  }

  /**
   * Attach the service field to data if service is set.
   * When service is not set, returns data unchanged (field absent, not empty).
   */
  private attachService(data?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!this.service) {
      return data;
    }
    return { ...data, service: this.service };
  }

  /**
   * Increment the count of resources that were actually updated.
   */
  recordUpdate(): void {
    this.updateCount++;
  }

  /**
   * Check if there's actionable content to flush (updates or errors).
   * Returns true if shouldFlush() was called after recordUpdate() or error() was invoked,
   * even though error() entries are emitted immediately and not part of the buffer.
   */
  shouldFlush(): boolean {
    return this.updateCount > 0 || this.errorCount > 0;
  }

  /**
   * Emit all buffered logs to console and clear the buffer.
   * Only entries below the emitLevel are in the buffer; immediately-emitted entries are not doubled.
   */
  flush(): void {
    for (const entry of this.entries) {
      this.emitEntry(entry);
    }
    this.entries = [];
  }

  /**
   * Get summary statistics (for debugging).
   */
  stats(): { entries: number; updates: number; errors: number } {
    return {
      entries: this.entries.length,
      updates: this.updateCount,
      errors: this.errorCount,
    };
  }
}
