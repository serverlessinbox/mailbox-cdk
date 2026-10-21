import { parseLogLevelStrict, type LogLevel } from '../../../ts-lambdas/shared/logger-buffer';

import * as env                               from './config-env';

/** The environment every Lambda reads: the level of its logger and the service name its logs carry. */
export interface BaseConfig {
  readonly logLevel: LogLevel;
  readonly serviceName: string;
}

/** Reads LOG_LEVEL, defaulting to `error`; a value that is not a log level is reported, not defaulted. */
export function loadLogLevel(l: env.Loader): LogLevel {
  return env.optionalAs(l, 'LOG_LEVEL', 'error', parseLogLevelStrict);
}

/** Reads the environment every Lambda shares. */
export function loadBaseConfig(l: env.Loader): BaseConfig {
  return {
    logLevel: loadLogLevel(l),
    serviceName: l.mandatory('SERVICE_NAME'),
  };
}
