import { loadBaseConfig, type BaseConfig } from '../handler-kit/config/config-base';
import type * as env                       from '../handler-kit/config/config-env';

/** The environment the stack-helpers Lambda reads: the shared base only. */
export type Config = BaseConfig;

export function load(l: env.Loader): Config {
  return loadBaseConfig(l);
}
