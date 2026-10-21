import { loadBaseConfig, type BaseConfig } from '../../runtime/handler-kit/config/config-base';
import type * as env                       from '../../runtime/handler-kit/config/config-env';

/** The environment the bucket-auto-empty Lambda reads: the shared base only. */
export type Config = BaseConfig;

export function load(l: env.Loader): Config {
  return loadBaseConfig(l);
}
