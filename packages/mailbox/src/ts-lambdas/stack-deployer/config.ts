import { env, parseLogLevelStrict, type LogLevel } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/**
 * Config shared by both the starter and worker Lambdas — the fields every stack-deployer
 * invocation reads regardless of which physical function it runs in.
 */
export interface WorkerConfig {
  readonly logLevel: LogLevel;
  readonly serviceName: string;
}

/**
 * Config for the starter Lambda only. Extends WorkerConfig because the starter needs
 * everything the worker needs plus the state machine it starts.
 *
 * The worker does NOT extend this: it never starts the state machine, so it must not be made to
 * depend on MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN, which the CDK only sets on the starter's
 * environment (see stack-deployer-starter.ts). Loading one shared Config for both Lambdas made the
 * worker fail on every invocation once that var became mandatory (2026-09-13 regression).
 */
export interface StarterConfig extends WorkerConfig {
  readonly stateMachineArn: string;
}

export function loadWorker(l: env.Loader): WorkerConfig {
  return {
    logLevel: env.optionalAs(l, 'LOG_LEVEL', 'error', parseLogLevelStrict),
    // BWCOMPAT(2026-09-01): SERVICE_NAME read as optional — no already-deployed template sets it.
    // Remove when: every live stack has had a Path 2 template update on/after 2026-09-01.
    serviceName: l.optional('SERVICE_NAME', ''),
  };
}

export function loadStarter(l: env.Loader): StarterConfig {
  return {
    ...loadWorker(l),
    stateMachineArn: l.mandatory('MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN'),
  };
}
