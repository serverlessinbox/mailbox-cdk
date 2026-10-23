import { loadBaseConfig, type BaseConfig } from '../../runtime/handler-kit/config/config-base';
import type * as env                       from '../../runtime/handler-kit/config/config-env';

/** The environment the content-deployer Lambda reads: the shared base only. */
export type Config = BaseConfig;

export function load(loader: env.Loader): Config {
  return loadBaseConfig(loader);
}
