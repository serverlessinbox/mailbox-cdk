import { ArtifactZone }      from '@serverlessinbox/artifact-registry-cdk';
import * as path             from 'node:path';

import type { BakedPackage } from './baked-package';

/** The publishable packages of this repo, each with the `artifact-versions.json` it ships and the packages it pins. */
export class BakedPackages {
  /**
   * The files to bake for the repository at `root`. `mailbox-cdk` and `mailbox-cdk-edge` are both
   * published from the `mailbox` package folder, so they take its version.
   */
  public static forRepository(root: string, mailboxPinsFile: string): BakedPackage[] {
    const mailboxDirectory = path.join(root, 'packages', 'mailbox');
    const cognitoDirectory = path.join(root, 'packages', 'mailbox-cognito');
    const sharedDirectory  = path.join(root, 'packages', 'mailbox-cdk-shared');
    return [
      {
        outputFile:       path.join(mailboxDirectory, 'artifact-versions.json'),
        externalPinsFile: mailboxPinsFile,
        ownArtifacts:     [
          { key: 'mailbox-cdk', zone: ArtifactZone.REGIONAL, manifestDirectory: mailboxDirectory },
          { key: 'mailbox-cdk-edge', zone: ArtifactZone.EDGE, manifestDirectory: mailboxDirectory },
          { key: 'mailbox-cdk-shared', zone: ArtifactZone.REGIONAL, manifestDirectory: sharedDirectory },
        ],
      },
      {
        outputFile:   path.join(cognitoDirectory, 'artifact-versions.json'),
        ownArtifacts: [
          { key: 'mailbox-cognito', zone: ArtifactZone.REGIONAL, manifestDirectory: cognitoDirectory },
          { key: 'mailbox-cdk-shared', zone: ArtifactZone.REGIONAL, manifestDirectory: sharedDirectory },
        ],
      },
    ];
  }
}
