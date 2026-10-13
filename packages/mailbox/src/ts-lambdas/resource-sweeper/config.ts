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

export function loadStarter(l: env.Loader): StarterConfig {
  return {
    logLevel: env.optionalAs(l, 'LOG_LEVEL', 'error', parseLogLevelStrict),
    serviceName: l.mandatory('SERVICE_NAME'),
    sweeperStateMachineArn: l.mandatory('MAILBOX_SWEEPER_STATE_MACHINE_ARN'),
  };
}

export function loadWorker(l: env.Loader): WorkerConfig {
  return {
    logLevel: env.optionalAs(l, 'LOG_LEVEL', 'error', parseLogLevelStrict),
    serviceName: l.mandatory('SERVICE_NAME'),
  };
}
