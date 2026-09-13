/**
 * Staleness resolution: check if an artifact has a newer version available.
 * Shared preamble logic for all three update paths (code, ui, edge).
 */

import { deriveTrack, readReleasePointer } from '@serverlessinbox/artifact-registry';
import { valid as semverValid, gt as semverGt, parse as semverParse, SemVer } from 'semver';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { UpdaterTargetConfig } from './common';

/** Result of checking staleness: pointer + parsed semver, or null if no update. */
export interface StaleTarget {
  pointer: { version: string };
  parsed: SemVer;
}

/**
 * Resolve whether a target is stale and deserves an update.
 * Returns the release pointer + parsed version if newer; null if no update needed.
 *
 * Logs and returns null for:
 * - No pointer available
 * - Invalid semver (pointer or deployed)
 * - Pointer version is not strictly newer
 * - Parse failure (should not happen given semverValid guard)
 */
export async function resolveStaleTarget(
  region: string,
  packageName: string,
  deployedVersion: string,
  logger: LoggerBuffer,
  config: UpdaterTargetConfig,
): Promise<StaleTarget | null> {
  const { distTag, granularity, project, artifactBucketBase } = config;

  // Derive the track from the deployed version.
  const myTrack = deriveTrack(deployedVersion, granularity as 'major' | 'minor');

  // Read the track-scoped pointer.
  const pointer = await readReleasePointer(packageName, distTag, region, {
    bucketBase: artifactBucketBase,
    project,
    track: myTrack,
  });

  if (!pointer) {
    logger.debug('no pointer available', { packageName, distTag, track: myTrack });
    return null;
  }

  // Guard against invalid versions: skip if either version isn't semver-valid.
  if (!semverValid(pointer.version) || !semverValid(deployedVersion)) {
    logger.debug('invalid version format, skipping', {
      deployedVersion,
      candidateVersion: pointer.version,
      deployedVersionValid: semverValid(deployedVersion),
      candidateVersionValid: semverValid(pointer.version),
    });
    return null;
  }

  // Check if the candidate version is strictly newer.
  if (!semverGt(pointer.version, deployedVersion)) {
    logger.debug('version is not newer', {
      deployedVersion,
      candidateVersion: pointer.version,
    });
    return null;
  }

  // Parse the version (should never fail given the semverValid guard above).
  const parsed = semverParse(pointer.version);
  if (!parsed) {
    logger.debug('failed to parse version (logic error: semverValid guard should have prevented this)', {
      version: pointer.version,
    });
    return null;
  }

  return { pointer, parsed };
}
