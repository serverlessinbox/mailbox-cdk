import type { S3Client } from '@aws-sdk/client-s3';
import { buildArtifactKey, deriveTrack, readReleasePointer } from '@serverlessinbox/artifact-registry';
import { valid as semverValid, gt as semverGt, parse as semverParse, SemVer } from 'semver';
import { LoggerBuffer, type Region } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { UpdaterTargetConfig } from './config';
import {
  toArtifactBucketName,
  toArtifactVersion,
  type ArtifactBucketName,
  type ArtifactPackageName,
  type ArtifactVersion,
} from './updater-identifiers';

/** A release newer than the deployed version: its version as published and parsed, and the deployed version parsed. */
export interface StaleTarget {
  readonly version: ArtifactVersion;
  readonly parsed: SemVer;
  readonly deployed: SemVer;
}

/** Where one release object of a package is stored. */
export interface ArtifactLocation {
  readonly bucket: ArtifactBucketName;
  readonly key: string;
}

/**
 * The release artifacts the updater follows: finds the release a deployed version is behind on, and locates
 * a release object. It decides nothing about how an artifact is installed.
 */
export class ReleaseArtifacts {
  private readonly registryS3: S3Client;
  private readonly config: UpdaterTargetConfig;
  private readonly logger: LoggerBuffer;

  constructor(registryS3: S3Client, config: UpdaterTargetConfig, logger: LoggerBuffer) {
    this.registryS3 = registryS3;
    this.config = config;
    this.logger = logger;
  }

  /**
   * The release the deployed version is strictly behind on its track, or null when there is none: no release
   * pointer, a pointer or deployed version that is not a semantic version, or a pointer that is not newer.
   */
  public async findNewer(
    region: Region,
    packageName: ArtifactPackageName,
    deployedVersion: ArtifactVersion,
  ): Promise<StaleTarget | null> {
    const { distTag, granularity, project, artifactBucketBase } = this.config;
    const track = deriveTrack(deployedVersion, granularity);

    const pointer = await readReleasePointer(
      this.registryS3,
      { bucketBase: artifactBucketBase, project },
      packageName,
      distTag,
      region,
      track,
    );
    if (!pointer) {
      this.logger.debug('no pointer available', { packageName, distTag, track });
      return null;
    }

    if (!semverValid(pointer.version) || !semverValid(deployedVersion)) {
      this.logger.debug('invalid version format, skipping', {
        deployedVersion,
        candidateVersion: pointer.version,
        deployedVersionValid: semverValid(deployedVersion),
        candidateVersionValid: semverValid(pointer.version),
      });
      return null;
    }

    if (!semverGt(pointer.version, deployedVersion)) {
      this.logger.debug('version is not newer', {
        deployedVersion,
        candidateVersion: pointer.version,
      });
      return null;
    }

    const parsed = semverParse(pointer.version);
    const deployed = semverParse(deployedVersion);
    if (!parsed || !deployed) {
      this.logger.debug('failed to parse version (logic error: semverValid guard should have prevented this)', {
        version: pointer.version,
      });
      return null;
    }

    return { version: toArtifactVersion(pointer.version), parsed, deployed };
  }

  /** The bucket of the region and the key of the object of one release of the package. */
  public locate(
    region: Region,
    packageName: ArtifactPackageName,
    release: SemVer,
    objectName: string,
  ): ArtifactLocation {
    const key = buildArtifactKey('package', packageName, {
      type: 'release',
      version: release,
      objectName,
      project: this.config.project,
    });
    return { bucket: toArtifactBucketName(`${this.config.artifactBucketBase}-${region}`), key };
  }
}
