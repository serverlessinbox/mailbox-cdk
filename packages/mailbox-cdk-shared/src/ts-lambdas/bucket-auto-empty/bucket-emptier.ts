import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  type ListObjectVersionsCommandOutput,
  type ObjectIdentifier,
  type S3Client,
} from '@aws-sdk/client-s3';

const DELETE_OBJECTS_BATCH_SIZE = 1000;

/** Where a page of a bucket's object versions starts; empty for the first page. */
interface VersionListingPosition {
  readonly keyMarker?: string;
  readonly versionIdMarker?: string;
}

/**
 * Deletes every object version and delete marker in a bucket, so that the bucket itself can be deleted.
 */
export class BucketEmptier {
  private readonly s3: S3Client;

  constructor(s3: S3Client) {
    this.s3 = s3;
  }

  /** Returns how many object versions and delete markers were deleted. */
  async empty(bucketName: string): Promise<number> {
    let deleted = 0;
    let position: VersionListingPosition | undefined = {};

    do {
      const page = await this.listVersions(bucketName, position);
      deleted += await this.deleteVersions(bucketName, this.identifiersIn(page));
      position = this.nextPosition(page);
    } while (position);

    return deleted;
  }

  private async listVersions(
    bucketName: string,
    position: VersionListingPosition,
  ): Promise<ListObjectVersionsCommandOutput> {
    return this.s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucketName,
        KeyMarker: position.keyMarker,
        VersionIdMarker: position.versionIdMarker,
      }),
    );
  }

  private identifiersIn(page: ListObjectVersionsCommandOutput): ObjectIdentifier[] {
    const entries = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])];
    return entries.flatMap((entry) =>
      entry.Key && entry.VersionId ? [{ Key: entry.Key, VersionId: entry.VersionId }] : [],
    );
  }

  private async deleteVersions(bucketName: string, identifiers: ObjectIdentifier[]): Promise<number> {
    let deleted = 0;

    for (let start = 0; start < identifiers.length; start += DELETE_OBJECTS_BATCH_SIZE) {
      const batch = identifiers.slice(start, start + DELETE_OBJECTS_BATCH_SIZE);
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: { Objects: batch, Quiet: true },
        }),
      );
      deleted += batch.length;
    }

    return deleted;
  }

  private nextPosition(page: ListObjectVersionsCommandOutput): VersionListingPosition | undefined {
    if (!page.IsTruncated || !page.NextKeyMarker) {
      return undefined;
    }
    return { keyMarker: page.NextKeyMarker, versionIdMarker: page.NextVersionIdMarker };
  }
}
