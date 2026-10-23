import { loadBaseConfig, type BaseConfig, type env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/** The environment the data override resolver Lambda reads: the shared base only. */
export type Config = BaseConfig;

export function load(loader: env.Loader): Config {
  return loadBaseConfig(loader);
}
