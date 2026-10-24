import { loadBaseConfig, type BaseConfig, type env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/** The environment of the bootstrap user Lambda: the base configuration every Lambda reads, and nothing more. */
export type Config = BaseConfig;

export function load(loader: env.Loader): Config {
  return loadBaseConfig(loader);
}
