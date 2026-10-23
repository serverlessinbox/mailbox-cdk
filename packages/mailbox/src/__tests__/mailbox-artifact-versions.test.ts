import { readFileSync }                from 'node:fs';
import * as path                       from 'node:path';
import * as t                          from 'typanion';

import { loadMailboxArtifactVersions } from '../mailbox-artifact-versions';

const isPackageRootVersions = t.isDict(t.isObject({
  version: t.isString(),
  zone:    t.isString(),
}));

/**
 * Pins that the loader resolves and accepts the `artifact-versions.json` at the root of the
 * `mailbox` package (the file that package publishes), not one belonging to another package, and that
 * it lists every package `Mailbox` resolves, so a missing entry cannot ship unnoticed.
 */
describe('loadMailboxArtifactVersions', () => {
  it('loads the artifact versions at the package root', () => {
    const packageRootText: string      = readFileSync(path.join(__dirname, '..', '..', 'artifact-versions.json'), 'utf8');
    const packageRootVersions: unknown = JSON.parse(packageRootText);
    t.assert(packageRootVersions, isPackageRootVersions);

    expect(loadMailboxArtifactVersions()).toEqual(packageRootVersions);
  });

  it('lists every package Mailbox resolves, the edge package in the edge zone', () => {
    const versions = loadMailboxArtifactVersions();

    expect(Object.keys(versions).sort()).toEqual([
      'mailbox-admin-ui', 'mailbox-cdk', 'mailbox-cdk-edge', 'mailbox-cdk-shared', 'mailbox-go', 'mailbox-webmail-ui',
    ]);
    expect(versions['mailbox-cdk-edge'].zone).toBe('edge');
  });
});
