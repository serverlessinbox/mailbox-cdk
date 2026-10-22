import type { CloudFormationClient } from '@aws-sdk/client-cloudformation';

import type { Config }               from './config';
import type { UpdaterClients }       from './updater-clients';

/** A valid configuration together with the clients built from it. */
export interface ReadyUpdater {
  readonly config: Config;
  /** Reads the status of the stack a custom-resource request belongs to. */
  readonly cloudFormation: CloudFormationClient;
  readonly clients:        UpdaterClients;
  readonly error:          undefined;
}

/**
 * A configuration that failed to load; no clients exist because the region they need may be the missing value.
 * The CloudFormation client exists all the same, because a custom-resource request must still be answered.
 */
export interface FailedUpdater {
  readonly config:         Config;
  readonly cloudFormation: CloudFormationClient;
  readonly clients:        undefined;
  readonly error:          string;
}

/** What the entry point hands to every trigger: either ready to run, or the configuration problem to report. */
export type UpdaterRuntime = ReadyUpdater | FailedUpdater;
