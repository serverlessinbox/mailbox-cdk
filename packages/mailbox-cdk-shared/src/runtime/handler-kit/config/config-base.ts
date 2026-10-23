import { parseLogLevelStrict, type LogLevel } from '../log-level';

import * as env                               from './config-env';

/** The environment every Lambda reads: the level of its logger and the service name its logs carry. */
export interface BaseConfig {
  readonly logLevel:    LogLevel;
  readonly serviceName: string;
}

/** Reads LOG_LEVEL, defaulting to `error`; a value that is not a log level is reported, not defaulted. */
export function loadLogLevel(loader: env.Loader): LogLevel {
  return env.optionalAs(loader, 'LOG_LEVEL', 'error', parseLogLevelStrict);
}

/** Reads the environment every Lambda shares. */
export function loadBaseConfig(loader: env.Loader): BaseConfig {
  return {
    logLevel:    loadLogLevel(loader),
    serviceName: loader.mandatory('SERVICE_NAME'),
  };
}
