import { env, loadBaseConfig, type BaseConfig } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/** Config of the starter Lambda, read from its own environment. */
export interface StarterConfig extends BaseConfig {
  readonly sweeperStateMachineArn: string;
}

/** Config of the worker Lambda, read from its own environment: the shared base only. */
export type WorkerConfig = BaseConfig;

export function loadStarter(l: env.Loader): StarterConfig {
  return {
    ...loadBaseConfig(l),
    sweeperStateMachineArn: l.mandatory('MAILBOX_SWEEPER_STATE_MACHINE_ARN'),
  };
}

export function loadWorker(l: env.Loader): WorkerConfig {
  return loadBaseConfig(l);
}
