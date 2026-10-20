import { loadEmbeddedRegistryRecord } from '@serverlessinbox/mailbox-cdk-shared';
import type { RegistryRecord }        from '@serverlessinbox/mailbox-cdk-shared';
import * as path                      from 'node:path';

/** `registry-record.json` sits at the package root, one directory above both `src/` and `lib/`. */
const MAILBOX_REGISTRY_RECORD_PATH = path.join(__dirname, '..', 'registry-record.json');

/** Loads the registry record committed with the `mailbox` package. */
export function loadMailboxRegistryRecord(): RegistryRecord {
  return loadEmbeddedRegistryRecord(MAILBOX_REGISTRY_RECORD_PATH);
}
