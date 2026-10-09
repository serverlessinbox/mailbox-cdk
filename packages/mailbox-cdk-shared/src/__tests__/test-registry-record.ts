import type { RegistryRecord } from '@serverlessinbox/artifact-registry/registry';

/** A registry record for tests that need one to build artifact constructs; independent of any package's committed record. */
export const TEST_REGISTRY_RECORD: RegistryRecord = {
  schemaVersion: 1,
  bucketBase: 'mailbox-artifacts',
  project: 'serverlessinbox',
  regions: ['eu-west-1', 'us-east-1'],
  ownerAccountId: '111111111111',
};
