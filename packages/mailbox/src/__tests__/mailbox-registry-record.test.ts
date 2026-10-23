import { readFileSync }              from 'node:fs';
import * as path                     from 'node:path';
import * as t                        from 'typanion';

import { loadMailboxRegistryRecord } from '../mailbox-registry-record';

const isPackageRootRecord = t.isObject({
  schemaVersion:  t.isNumber(),
  bucketBase:     t.isString(),
  project:        t.isString(),
  regions:        t.isArray(t.isString()),
  ownerAccountId: t.isString(),
});

/**
 * Pins that the loader resolves the `registry-record.json` at the root of the `mailbox` package
 * (the file that package publishes), not one belonging to another package.
 */
describe('loadMailboxRegistryRecord', () => {
  it('loads the registry record at the package root', () => {
    const packageRootText: string    = readFileSync(path.join(__dirname, '..', '..', 'registry-record.json'), 'utf8');
    const packageRootRecord: unknown = JSON.parse(packageRootText);
    t.assert(packageRootRecord, isPackageRootRecord);

    expect(loadMailboxRegistryRecord()).toEqual(packageRootRecord);
  });
});
