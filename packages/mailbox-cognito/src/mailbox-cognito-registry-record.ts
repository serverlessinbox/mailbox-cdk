import * as path from 'node:path';
import { loadEmbeddedRegistryRecord } from '@serverlessinbox/mailbox-cdk-shared';
import type { RegistryRecord } from '@serverlessinbox/mailbox-cdk-shared';

/** `registry-record.json` sits at the package root, one directory above both `src/` and `lib/`. */
const MAILBOX_COGNITO_REGISTRY_RECORD_PATH = path.join(__dirname, '..', 'registry-record.json');

/** Loads the registry record committed with the `mailbox-cognito` package. */
export function loadMailboxCognitoRegistryRecord(): RegistryRecord {
  return loadEmbeddedRegistryRecord(MAILBOX_COGNITO_REGISTRY_RECORD_PATH);
}
