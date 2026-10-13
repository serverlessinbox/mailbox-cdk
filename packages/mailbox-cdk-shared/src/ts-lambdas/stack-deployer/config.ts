import { loadBaseConfig, type BaseConfig } from '../shared/base-config';
import type * as env from '../shared/env';

/** The environment of the stack-deployer worker function: the shared base only. */
export type WorkerConfig = BaseConfig;

/**
 * The environment of the stack-deployer starter function: the shared base plus the state machine it starts.
 * The worker never starts the state machine, so its config does not include this variable.
 */
export interface StarterConfig extends BaseConfig {
  readonly stateMachineArn: string;
}

export function loadWorker(l: env.Loader): WorkerConfig {
  return loadBaseConfig(l);
}

export function loadStarter(l: env.Loader): StarterConfig {
  return {
    ...loadBaseConfig(l),
    stateMachineArn: l.mandatory('MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN'),
  };
}
