/** The structured fields written beside a log message. */
export type LogFields = Record<string, unknown>;

/**
 * The buffered logger an addon handler writes the trace of each request to. Entries below the emit level are
 * held until `flush`, which the handler calls only for a request that failed with a server error.
 */
export interface RequestLogger {
  debug(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  flush(): void;
}
