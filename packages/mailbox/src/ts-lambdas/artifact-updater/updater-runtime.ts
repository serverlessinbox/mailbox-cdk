import type { Config } from './config';
import type { UpdaterClients } from './updater-clients';

/** A valid configuration together with the clients built from it. */
export interface ReadyUpdater {
  readonly config: Config;
  readonly clients: UpdaterClients;
  readonly error: undefined;
}

/** A configuration that failed to load; no clients exist because the region they need may be the missing value. */
export interface FailedUpdater {
  readonly config: Config;
  readonly clients: undefined;
  readonly error: string;
}

/** What the entry point hands to every trigger: either ready to run, or the configuration problem to report. */
export type UpdaterRuntime = ReadyUpdater | FailedUpdater;
