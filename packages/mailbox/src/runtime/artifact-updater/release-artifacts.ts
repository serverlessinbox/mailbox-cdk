import type { S3Client }                                                      from '@aws-sdk/client-s3';
import { buildArtifactKey, deriveTrack, readReleasePointer }                  from '@serverlessinbox/artifact-registry';
import type { LoggerBuffer, Region }                                          from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { gt as semverGt, parse as semverParse, type SemVer }                  from 'semver';

import type { ArtifactCoordinates }                                           from './artifact-target';
import type { UpdaterTargetConfig }                                           from './config';
import {
  toArtifactBucketName,
  toArtifactVersion,
  type ArtifactBucketName,
  type ArtifactPackageName,
  type ArtifactVersion,
} from './updater-identifiers';

/** A release newer than the deployed version: its version as published and parsed, and the deployed version parsed. */
export interface StaleTarget {
  readonly version:  ArtifactVersion;
  readonly parsed:   SemVer;
  readonly deployed: SemVer;
}

/** Where one release object of a package is stored. */
export interface ArtifactLocation {
  readonly bucket: ArtifactBucketName;
  readonly key:    string;
}

/**
 * The release artifacts the updater follows: finds the release a deployed version is behind on, and owns where
 * each kind of artifact is stored in a release. It decides nothing about how an artifact is installed.
 */
export class ReleaseArtifacts {
  private readonly registryS3: S3Client;
  private readonly config: UpdaterTargetConfig;
  private readonly logger: LoggerBuffer;

  constructor(registryS3: S3Client, config: UpdaterTargetConfig, logger: LoggerBuffer) {
    this.registryS3 = registryS3;
    this.config     = config;
    this.logger     = logger;
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
    const track                                                 = deriveTrack(deployedVersion, granularity);

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

    const parsed   = semverParse(pointer.version);
    const deployed = semverParse(deployedVersion);
    if (!parsed || !deployed) {
      this.logger.debug('invalid version format, skipping', {
        deployedVersion,
        candidateVersion:      pointer.version,
        deployedVersionValid:  deployed?.version ?? null,
        candidateVersionValid: parsed?.version ?? null,
      });
      return null;
    }

    if (!semverGt(parsed, deployed)) {
      this.logger.debug('version is not newer', {
        deployedVersion,
        candidateVersion: pointer.version,
      });
      return null;
    }

    return { version: toArtifactVersion(pointer.version), parsed, deployed };
  }

  /** The location of the zip of a Lambda function's code in one release of its package. */
  public locateLambdaCode(region: Region, target: ArtifactCoordinates, release: SemVer): ArtifactLocation {
    return this.locate(region, target.packageName, release, `lambdas/${target.artifactName}.zip`);
  }

  /** The location of a UI bundle in one release of its package; the bundle is stored under its artifact name. */
  public locateUiBundle(region: Region, target: ArtifactCoordinates, release: SemVer): ArtifactLocation {
    return this.locate(region, target.packageName, release, target.artifactName);
  }

  private locate(
    region: Region,
    packageName: ArtifactPackageName,
    release: SemVer,
    objectName: string,
  ): ArtifactLocation {
    const key = buildArtifactKey('package', packageName, {
      type:    'release',
      version: release,
      objectName,
      project: this.config.project,
    });
    return { bucket: toArtifactBucketName(`${this.config.artifactBucketBase}-${region}`), key };
  }
}
