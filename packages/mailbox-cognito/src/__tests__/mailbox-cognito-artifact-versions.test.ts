import { readFileSync }                       from 'node:fs';
import * as path                              from 'node:path';

import { loadMailboxCognitoArtifactVersions } from '../mailbox-cognito-artifact-versions';

/**
 * Pins that the loader resolves and accepts the `artifact-versions.json` at the root of the
 * `mailbox-cognito` package (the file that package publishes), not one belonging to another package.
 */
describe('loadMailboxCognitoArtifactVersions', () => {
  it('loads the artifact versions at the package root', () => {
    const packageRootVersions: unknown = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'artifact-versions.json'), 'utf8'));

    expect(loadMailboxCognitoArtifactVersions()).toEqual(packageRootVersions);
  });
});
