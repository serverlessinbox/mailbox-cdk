/**
 * Pins that `createMailboxPinnedResolver` pins from the registry record and artifact versions shipped
 * with the package, and lets the CDK context override the versions. A resolver pinned from anything
 * else would deploy Lambda code from another release line than the one this package was built for.
 */

import { App, Stack }                  from 'aws-cdk-lib';

import { createMailboxPinnedResolver } from '../mailbox-pinned-resolver';
import { loadMailboxRegistryRecord }   from '../mailbox-registry-record';

const OVERRIDDEN_VERSION = '7.7.7';

describe('createMailboxPinnedResolver', () => {
  it('reads from the registry location of the shipped record', () => {
    const record = loadMailboxRegistryRecord();

    const resolver = createMailboxPinnedResolver(new Stack(new App(), 'TestStack'));

    expect(resolver.location).toMatchObject({ bucketBase: record.bucketBase, project: record.project });
  });

  it('pins the version the CDK context names for a package', () => {
    const context = {
      'serverlessinbox:artifacts': {
        bucketBase: 'test-artifacts',
        packages:   { 'mailbox-go': { zone: 'regional', version: OVERRIDDEN_VERSION } },
      },
    };

    const resolver = createMailboxPinnedResolver(new Stack(new App({ context }), 'TestStack'));

    expect(resolver.getVersion('mailbox-go')).toBe(OVERRIDDEN_VERSION);
  });
});
