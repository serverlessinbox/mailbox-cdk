import { env, parseLogLevelStrict, type LogLevel } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

export interface Config {
  readonly logLevel: LogLevel;
  readonly serviceName: string;
}

export function load(l: env.Loader): Config {
  return {
    logLevel: env.optionalAs(l, 'LOG_LEVEL', 'error', parseLogLevelStrict),
    serviceName: l.optional('SERVICE_NAME', ''),
  };
}
