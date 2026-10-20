import { readFileSync }                     from 'node:fs';
import * as path                            from 'node:path';

import { loadMailboxCognitoRegistryRecord } from '../mailbox-cognito-registry-record';

/**
 * Pins that the loader resolves the `registry-record.json` at the root of the `mailbox-cognito`
 * package (the file that package publishes), not one belonging to another package.
 */
describe('loadMailboxCognitoRegistryRecord', () => {
  it('loads the registry record at the package root', () => {
    const packageRootRecord = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'registry-record.json'), 'utf8'));

    expect(loadMailboxCognitoRegistryRecord()).toEqual(packageRootRecord);
  });
});
