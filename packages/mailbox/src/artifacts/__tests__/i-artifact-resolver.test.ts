/**
 * Drift guard between the jsii-exported `RegistryLocation` and the artifact-registry
 * `RegistryLocation` the shared engine and resolvers return. Both describe the same value and
 * are passed to each other without a cast, so a field added, removed or retyped on one side
 * only must fail `tsc -p tsconfig.test.json`. Jest does not type-check, so the guard is the
 * functions below compiling; the test only keeps the file a valid suite.
 *
 * Two-way assignability alone accepts an extra optional field on either side, so the field names
 * are compared in both directions as well.
 */
import type { RegistryLocation as CoreRegistryLocation } from '@serverlessinbox/artifact-registry/registry';
import type { RegistryLocation as MailboxRegistryLocation } from '../i-artifact-resolver';

function mailboxToCore(location: MailboxRegistryLocation): CoreRegistryLocation {
  return location;
}

function coreToMailbox(location: CoreRegistryLocation): MailboxRegistryLocation {
  return location;
}

function mailboxFieldToCore(field: keyof MailboxRegistryLocation): keyof CoreRegistryLocation {
  return field;
}

function coreFieldToMailbox(field: keyof CoreRegistryLocation): keyof MailboxRegistryLocation {
  return field;
}

describe('RegistryLocation', () => {
  it('passes a location with per-region bucket overrides between the two definitions unchanged', () => {
    const location: MailboxRegistryLocation = {
      bucketBase: 'mailbox-artifacts',
      project: 'serverlessinbox',
      bucketOverrides: { 'eu-west-1': 'custom-eu-bucket' },
    };

    expect(coreToMailbox(mailboxToCore(location))).toEqual(location);
  });

  it('names its optional field the same in both definitions', () => {
    expect(coreFieldToMailbox(mailboxFieldToCore('bucketOverrides'))).toBe('bucketOverrides');
  });
});
