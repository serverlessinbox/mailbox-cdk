import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { loadMailboxArtifactVersions } from '../mailbox-artifact-versions';

/**
 * Pins that the loader resolves and accepts the `artifact-versions.json` at the root of the
 * `mailbox` package (the file that package publishes), not one belonging to another package, and that
 * it lists every package `Mailbox` resolves, so a missing entry cannot ship unnoticed.
 */
describe('loadMailboxArtifactVersions', () => {
  it('loads the artifact versions at the package root', () => {
    const packageRootVersions = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'artifact-versions.json'), 'utf8'));

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
