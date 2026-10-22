import { env, loadBaseConfig, toRegion, type BaseConfig, type Region } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/** Config of the worker Lambda, read from its own environment: the shared base and the region its clients call. */
export interface WorkerConfig extends BaseConfig {
  readonly region: Region;
}

/** Config of the starter Lambda, read from its own environment. */
export interface StarterConfig extends WorkerConfig {
  readonly sweeperStateMachineArn: string;
}

export function loadStarter(l: env.Loader): StarterConfig {
  return {
    ...loadWorker(l),
    sweeperStateMachineArn: l.mandatory('MAILBOX_SWEEPER_STATE_MACHINE_ARN'),
  };
}

export function loadWorker(l: env.Loader): WorkerConfig {
  return {
    ...loadBaseConfig(l),
    region: toRegion(l.mandatory('AWS_REGION')),
  };
}
