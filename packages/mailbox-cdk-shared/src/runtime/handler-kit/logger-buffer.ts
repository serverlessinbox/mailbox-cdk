import { LOG_LEVELS, type LogLevel } from './log-level';

/** The structured fields written beside a log message. */
type LogData = Record<string, unknown>;

/** One log call: written at once when its level reaches the emit level, otherwise held until a flush. */
export interface LogEntry {
  level: LogLevel;
  message: string;
  data?: LogData;
}

/**
 * Keeps the diagnostic trace of one Lambda invocation without paying to store it. CloudWatch charges per byte
 * ingested, so a healthy invocation should write almost nothing, yet an invocation that fails must still show how
 * it got there. Code logs every meaningful step into the buffer as it happens; whether that trace is ever written
 * is decided afterwards, when the outcome is known: the handler flushes it for a failure nobody expected and
 * otherwise lets it go with the invocation. Only an entry important enough to stand alone is written at once.
 *
 * It does not decide when to flush and it does not read the environment: the handler owns the flush, and the
 * emit level arrives from the Lambda's validated config.
 */
export class LoggerBuffer {
  private entries: LogEntry[] = [];
  private readonly service: string | undefined;
  private readonly emitLevel: LogLevel;

  constructor(service?: string, level?: LogLevel) {
    this.service   = service;
    this.emitLevel = level ?? 'error';
  }

  public debug(message: string, data?: LogData): void {
    this.log('debug', message, data);
  }

  public info(message: string, data?: LogData): void {
    this.log('info', message, data);
  }

  public warn(message: string, data?: LogData): void {
    this.log('warn', message, data);
  }

  public error(message: string, data?: LogData): void {
    this.log('error', message, data);
  }

  /** Writes the held entries and empties the buffer; entries already written at once are not written again. */
  public flush(): void {
    for (const entry of this.entries) {
      this.emitEntry(entry);
    }
    this.entries = [];
  }

  private log(level: LogLevel, message: string, data?: LogData): void {
    const entry: LogEntry = { level, message, data: this.attachService(data) };

    if (this.isAtOrAboveLevel(level, this.emitLevel)) {
      this.emitEntry(entry);
    } else {
      this.entries.push(entry);
    }
  }

  private isAtOrAboveLevel(levelA: LogLevel, levelB: LogLevel): boolean {
    return LOG_LEVELS.indexOf(levelA) >= LOG_LEVELS.indexOf(levelB);
  }

  private emitEntry(entry: LogEntry): void {
    const consoleMethod = console[entry.level] || console.log;
    if (entry.data) {
      consoleMethod(entry.message, entry.data);
    } else {
      consoleMethod(entry.message);
    }
  }

  /** Adds the service field when a service is set; without one the data is returned unchanged. */
  private attachService(data?: LogData): LogData | undefined {
    if (!this.service) {
      return data;
    }
    return { ...data, service: this.service };
  }
}
