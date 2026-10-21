import { loadBaseConfig, type BaseConfig }         from '../../runtime/handler-kit/config/config-base';
import * as env                                    from '../../runtime/handler-kit/config/config-env';
import { toRegion, type Region }                   from '../../runtime/handler-kit/aws-identifiers';

import { toStateMachineArn, type StateMachineArn } from './deployer-identifiers';

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
  readonly region: Region;
}

export function loadWorker(l: env.Loader): WorkerConfig {
  return {
    ...loadBaseConfig(l),
    region: env.mandatoryAs(l, 'AWS_REGION', toRegion, UNUSABLE_REGION),
  };
}

export function loadStarter(l: env.Loader): StarterConfig {
  return {
    ...loadBaseConfig(l),
    stateMachineArn: env.mandatoryAs(l, 'MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN', toStateMachineArn, UNUSABLE_STATE_MACHINE_ARN),
    region: env.mandatoryAs(l, 'AWS_REGION', toRegion, UNUSABLE_REGION),
  };
}
