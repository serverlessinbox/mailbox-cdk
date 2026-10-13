import { loadBaseConfig, type BaseConfig } from '../shared/base-config';
import * as env from '../shared/env';
import { toStateMachineArn, type StateMachineArn } from './deployer-identifiers';

// Stands in for the state machine ARN when the variable is missing or invalid; the problem is recorded and the config is never used.
const UNUSABLE_STATE_MACHINE_ARN = toStateMachineArn('arn:aws:states:::stateMachine:unusable');

/** The environment of the stack-deployer worker function: the shared base only. */
export type WorkerConfig = BaseConfig;

/**
 * The environment of the stack-deployer starter function: the shared base plus the state machine it starts.
 * The worker never starts the state machine, so its config does not include this variable.
 */
export interface StarterConfig extends BaseConfig {
  readonly stateMachineArn: StateMachineArn;
}

export function loadWorker(l: env.Loader): WorkerConfig {
  return loadBaseConfig(l);
}

export function loadStarter(l: env.Loader): StarterConfig {
  return {
    ...loadBaseConfig(l),
    stateMachineArn: env.mandatoryAs(l, 'MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN', toStateMachineArn, UNUSABLE_STATE_MACHINE_ARN),
  };
}
