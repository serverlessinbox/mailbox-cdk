import { loadBaseConfig, type BaseConfig } from '../shared/base-config';
import type * as env from '../shared/env';

/** The environment the content-deployer Lambda reads: the shared base only. */
export type Config = BaseConfig;

export function load(l: env.Loader): Config {
  return loadBaseConfig(l);
}
