import { Loader, optionalAs } from '../shared/env';
import { LogLevel, parseLogLevelStrict } from '../shared/logger-buffer';

export interface Config {
  readonly logLevel: LogLevel;
  readonly serviceName: string;
}

export function load(l: Loader): Config {
  return {
    logLevel: optionalAs(l, 'LOG_LEVEL', 'error', parseLogLevelStrict),
    serviceName: l.mandatory('SERVICE_NAME'),
  };
}
