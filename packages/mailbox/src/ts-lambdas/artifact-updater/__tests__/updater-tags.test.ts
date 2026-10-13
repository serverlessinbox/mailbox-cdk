/// <reference types="jest" />

/**
 * Pins that the tag keys the updater reads and writes are the keys the stack puts on its resources. A key the
 * two sides spell differently makes the updater see no resource, or tag a version no scan reads back; the
 * compiler checks the keys and the runtime assertion pins their values.
 */

import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import { UpdaterTagKeys } from '../updater-tags';

describe('UpdaterTagKeys', () => {
  it('uses the keys the stack tags its resources with', () => {
    const stackKeys = {
      rootStack: ServerlessInboxTagKeys.rootStack,
      autoUpdateType: ServerlessInboxTagKeys.autoUpdateType,
      artifactPackage: ServerlessInboxTagKeys.artifactPackage,
      artifactName: ServerlessInboxTagKeys.artifactName,
      artifactVersion: ServerlessInboxTagKeys.artifactVersion,
      bucketName: ServerlessInboxTagKeys.bucketName,
    } satisfies typeof UpdaterTagKeys;

    expect(UpdaterTagKeys).toEqual(stackKeys);
  });
});
