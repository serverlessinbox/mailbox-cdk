import { loadLogLevel, type BaseConfig, type env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/** The environment of the bootstrap user Lambda: the base configuration every Lambda reads, and nothing more. */
export type Config = BaseConfig;

/** Reads `SERVICE_NAME` as optional where `loadBaseConfig` requires it, so an empty service name is accepted. */
export function load(l: env.Loader): Config {
  return {
    logLevel:    loadLogLevel(l),
    serviceName: l.optional('SERVICE_NAME', ''),
  };
}
