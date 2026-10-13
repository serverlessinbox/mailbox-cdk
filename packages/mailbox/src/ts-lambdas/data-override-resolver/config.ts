import { env, loadLogLevel, type BaseConfig } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/** Config of the data override resolver Lambda, whose service name is optional. */
export type Config = BaseConfig;

export function load(l: env.Loader): Config {
  return {
    logLevel: loadLogLevel(l),
    serviceName: l.optional('SERVICE_NAME', ''),
  };
}
