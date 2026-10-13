import { env, parseLogLevelStrict, type LogLevel } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/** Config of the starter Lambda, read from its own environment. */
export interface StarterConfig {
  readonly logLevel: LogLevel;
  readonly serviceName: string;
  readonly sweeperStateMachineArn: string;
}

/** Config of the worker Lambda, read from its own environment. */
export interface WorkerConfig {
  readonly logLevel: LogLevel;
  readonly serviceName: string;
}

/**
 * Reads the starter's configuration from the environment through `l`. `SERVICE_NAME` and
 * `MAILBOX_SWEEPER_STATE_MACHINE_ARN` are mandatory; `LOG_LEVEL` is optional and defaults to `error`.
 * Every missing or invalid variable is reported through `l`, all at once, rather than thrown.
 */
export function loadStarter(l: env.Loader): StarterConfig {
  return {
    logLevel: env.optionalAs(l, 'LOG_LEVEL', 'error', parseLogLevelStrict),
    serviceName: l.mandatory('SERVICE_NAME'),
    sweeperStateMachineArn: l.mandatory('MAILBOX_SWEEPER_STATE_MACHINE_ARN'),
  };
}

/**
 * Reads the worker's configuration from the environment through `l`. `SERVICE_NAME` is mandatory;
 * `LOG_LEVEL` is optional and defaults to `error`. The worker never reads the state machine ARN.
 * Every missing or invalid variable is reported through `l`, all at once, rather than thrown.
 */
export function loadWorker(l: env.Loader): WorkerConfig {
  return {
    logLevel: env.optionalAs(l, 'LOG_LEVEL', 'error', parseLogLevelStrict),
    serviceName: l.mandatory('SERVICE_NAME'),
  };
}
