import { env, parseLogLevelStrict, type LogLevel } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

export interface Config {
  readonly logLevel: LogLevel;
  readonly serviceName: string;
}

export function load(l: env.Loader): Config {
  return {
    logLevel: env.optionalAs(l, 'LOG_LEVEL', 'error', parseLogLevelStrict),
    // BWCOMPAT(2026-09-01): SERVICE_NAME read as optional — no already-deployed template sets it.
    // Remove when: every live stack has had a Path 2 template update on/after 2026-09-01.
    serviceName: l.optional('SERVICE_NAME', ''),
  };
}
