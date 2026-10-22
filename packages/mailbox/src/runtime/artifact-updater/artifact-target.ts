import type {
  ArtifactName,
  ArtifactPackageName,
  ArtifactVersion,
  ContentBucketName,
  DistributionArn,
  LambdaFunctionArn,
} from './updater-identifiers';

/** The release artifact a managed resource was deployed from, and the version it runs. */
export interface ArtifactCoordinates {
  readonly packageName:     ArtifactPackageName;
  readonly artifactName:    ArtifactName;
  readonly deployedVersion: ArtifactVersion;
}

/** A Lambda function whose code the updater can advance. */
export interface LambdaTarget extends ArtifactCoordinates {
  readonly arn: LambdaFunctionArn;
}

/** A CloudFront distribution in front of a UI bucket whose content the updater can advance. */
export interface UiTarget extends ArtifactCoordinates {
  readonly arn:        DistributionArn;
  readonly bucketName: ContentBucketName;
}
