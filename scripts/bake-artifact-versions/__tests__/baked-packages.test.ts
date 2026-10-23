import { PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { readFileSync }           from 'node:fs';
import * as path                  from 'node:path';

import { BakedPackages }          from '../baked-packages';

/**
 * Pins the mapping of each baked package to the artifacts it releases itself, against the
 * placeholders committed with each package: every own package the release bakes must already be
 * listed there with the zone the construct needs. A mistyped key or zone in the mapping would
 * otherwise only show up in a published package.
 */
describe('BakedPackages.forRepository', () => {
  const repoRoot        = path.join(__dirname, '..', '..', '..');
  const mailboxPinsFile = path.join(repoRoot, 'unused-pins.json');

  it.each(BakedPackages.forRepository(repoRoot, mailboxPinsFile).map(bakedPackage => [path.basename(path.dirname(bakedPackage.outputFile)), bakedPackage] as const))(
    'bakes %s own packages as its committed placeholder lists them',
    (_name, bakedPackage) => {
      const placeholder = PinnedArtifactResolver.parsePins(readFileSync(bakedPackage.outputFile, 'utf8'), bakedPackage.outputFile);

      for (const ownArtifact of bakedPackage.ownArtifacts) {
        expect(placeholder[ownArtifact.key]?.zone).toBe(ownArtifact.zone);
      }
    },
  );
});
