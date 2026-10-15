import { env, loadBaseConfig, type BaseConfig } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { ResourceSweeperEnvNames } from './env-names';

/** Config of the starter Lambda, read from its own environment. */
export interface StarterConfig extends BaseConfig {
  readonly sweeperStateMachineArn: string;
}

/** Config of the worker Lambda, read from its own environment: the shared base only. */
export type WorkerConfig = BaseConfig;

export function loadStarter(l: env.Loader): StarterConfig {
  return {
    ...loadBaseConfig(l),
    sweeperStateMachineArn: l.mandatory(ResourceSweeperEnvNames.stateMachineArn),
  };
}

export function loadWorker(l: env.Loader): WorkerConfig {
  return loadBaseConfig(l);
}
