#!/usr/bin/env ts-node

/**
 * Resolves the live track versions from S3 and writes them to track-versions.json
 * at the app root. The committed track-versions.json then acts as the version
 * anchor that conventional commits can steer — main.ts reads it at synth time
 * instead of resolving live.
 *
 * Requires AWS S3 credentials.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadTrackVersions } from '@serverlessinbox/artifact-registry';
import { packageRegions } from '../src/package-regions';

void (async () => {
  try {
    const result = await loadTrackVersions({
      bucketBase: 'mailbox-artifacts',
      artifactType: 'package',
      packages: packageRegions,
    });

    const outputPath = path.resolve(__dirname, '..', 'track-versions.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');

    console.log('Resolved versions:', result.resolvedVersions);
    console.log(`Wrote track versions to: ${outputPath}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
