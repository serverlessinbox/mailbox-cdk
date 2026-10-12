import { env, parseLogLevelStrict, type LogLevel } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/**
 * Config shared by both the starter and worker Lambdas.
 */
export interface WorkerConfig {
  readonly logLevel: LogLevel;
  readonly serviceName: string;
}

/**
 * Config for the starter Lambda only. The worker never starts the sweeper state machine, so it
 * must not be made to depend on MAILBOX_SWEEPER_STATE_MACHINE_ARN, which the CDK only sets on the
 * starter's environment (resource-sweeper-starter.ts). Loading one shared Config for both Lambdas
 * made the worker fail on every invocation once that var became mandatory (2026-09-13 regression).
 */
export interface StarterConfig extends WorkerConfig {
  readonly sweeperStateMachineArn: string;
}

export function loadWorker(l: env.Loader): WorkerConfig {
  return {
    logLevel: env.optionalAs(l, 'LOG_LEVEL', 'error', parseLogLevelStrict),
    serviceName: l.mandatory('SERVICE_NAME'),
  };
}

export function loadStarter(l: env.Loader): StarterConfig {
  return {
    ...loadWorker(l),
    sweeperStateMachineArn: l.mandatory('MAILBOX_SWEEPER_STATE_MACHINE_ARN'),
  };
}
