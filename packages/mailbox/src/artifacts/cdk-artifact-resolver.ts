import { Code } from 'aws-cdk-lib/aws-lambda';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import type { IConstruct } from 'constructs';
import { ArtifactResolver } from '@serverlessinbox/artifact-registry';
import type { IArtifactResolver, ArtifactResolverFactoryOptions } from '@serverlessinbox/artifact-registry';

export interface ICdkArtifactResolver extends IArtifactResolver {
  getCode(packageName: string, objectPath: string): Code;
}

export class CdkArtifactResolver extends ArtifactResolver implements ICdkArtifactResolver {
  private readonly _scope: IConstruct;
  private readonly _bucketCache = new Map<string, IBucket>();

  constructor(options: ArtifactResolverFactoryOptions, scope: IConstruct) {
    super(options);
    this._scope = scope;
  }

  getCode(packageName: string, objectPath: string): Code {
    const resolved = this.resolve(packageName, objectPath);
    if (!this._bucketCache.has(packageName)) {
      this._bucketCache.set(
        packageName,
        Bucket.fromBucketName(this._scope, `Bucket-${packageName}`, resolved.bucket),
      );
    }
    return Code.fromBucket(this._bucketCache.get(packageName)!, resolved.key, resolved.versionId);
  }
}
