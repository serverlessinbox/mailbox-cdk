import { toRegion, type Region }                   from '../../runtime/handler-kit/aws-identifiers';
import { loadBaseConfig, type BaseConfig }         from '../../runtime/handler-kit/config/config-base';
import * as env                                    from '../../runtime/handler-kit/config/config-env';

import { toStateMachineArn, type StateMachineArn } from './deployer-identifiers';

/** The environment variable the starter function reads the ARN of the state machine it starts from. */
export const STATE_MACHINE_ARN_VARIABLE = 'MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN';

// Stands in for the region when AWS_REGION is missing; the problem is recorded and the config is never used.
const UNUSABLE_REGION = toRegion('unusable');

// Stands in for the state machine ARN when the variable is missing or invalid; the problem is recorded and the config is never used.
const UNUSABLE_STATE_MACHINE_ARN = toStateMachineArn('arn:aws:states:::stateMachine:unusable');

/**
 * The environment of the stack-deployer worker function: the shared base plus the region the function runs
 * in, which is where an operation that names no region runs.
 */
export interface WorkerConfig extends BaseConfig {
  readonly region: Region;
}

/**
 * The environment of the stack-deployer starter function: the shared base plus the state machine it starts
 * and the region it runs in, where an operation that names no region reads its stack. The worker never starts
 * the state machine, so its config does not include that variable.
 */
export interface StarterConfig extends BaseConfig {
  readonly stateMachineArn: StateMachineArn;
  readonly region:          Region;
}

export function loadWorker(loader: env.Loader): WorkerConfig {
  return {
    ...loadBaseConfig(loader),
    region: env.mandatoryAs(loader, 'AWS_REGION', toRegion, UNUSABLE_REGION),
  };
}

export function loadStarter(loader: env.Loader): StarterConfig {
  return {
    ...loadBaseConfig(loader),
    stateMachineArn: env.mandatoryAs(loader, STATE_MACHINE_ARN_VARIABLE, toStateMachineArn, UNUSABLE_STATE_MACHINE_ARN),
    region:          env.mandatoryAs(loader, 'AWS_REGION', toRegion, UNUSABLE_REGION),
  };
}
