/**
 * Buffered logger for artifact-updater Lambda.
 *
 * Collects log messages in memory and flushes (emits to console) only when:
 * - At least one resource was updated (state change), OR
 * - An error occurred
 *
 * Silent on no-op runs (no updates, no errors) to reduce CloudWatch noise.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

export class LoggerBuffer {
  private entries: LogEntry[] = [];
  private updateCount: number = 0;
  private errorCount: number = 0;

  /**
   * Record a debug log (high-volume, typically skipped info).
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.entries.push({ level: 'debug', message, data });
  }

  /**
   * Record an info log (business state changes, updates).
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.entries.push({ level: 'info', message, data });
  }

  /**
   * Record a warning log.
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.entries.push({ level: 'warn', message, data });
  }

  /**
   * Record an error log and increment error counter.
   */
  error(message: string, data?: Record<string, unknown>): void {
    this.entries.push({ level: 'error', message, data });
    this.errorCount++;
  }

  /**
   * Increment the count of resources that were actually updated.
   */
  recordUpdate(): void {
    this.updateCount++;
  }

  /**
   * Check if there's actionable content to flush (updates or errors).
   */
  shouldFlush(): boolean {
    return this.updateCount > 0 || this.errorCount > 0;
  }

  /**
   * Emit all buffered logs to console and clear the buffer.
   */
  flush(): void {
    for (const entry of this.entries) {
      const consoleMethod = console[entry.level] || console.log;
      if (entry.data) {
        consoleMethod(entry.message, entry.data);
      } else {
        consoleMethod(entry.message);
      }
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
