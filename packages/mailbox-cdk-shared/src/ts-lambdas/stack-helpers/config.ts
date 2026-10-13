import * as env from '../shared/env';
import { parseLogLevelStrict, type LogLevel } from '../shared/logger-buffer';

/** The environment the stack-helpers Lambda reads. */
export interface Config {
  readonly logLevel: LogLevel;
  readonly serviceName: string;
}

export function load(l: env.Loader): Config {
  return {
    logLevel: env.optionalAs(l, 'LOG_LEVEL', 'error', parseLogLevelStrict),
    serviceName: l.mandatory('SERVICE_NAME'),
  };
}
