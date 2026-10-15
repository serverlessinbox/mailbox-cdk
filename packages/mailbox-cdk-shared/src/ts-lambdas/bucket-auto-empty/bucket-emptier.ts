import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  type ListObjectVersionsCommandOutput,
  type ObjectIdentifier,
  type S3Client,
} from '@aws-sdk/client-s3';
import { ExpectedFailure } from '../shared/expected-failure';

const DELETE_OBJECTS_BATCH_SIZE = 1000;

// One page of up to 1000 versions is listed and deleted per iteration; each of the two S3 calls takes
// seconds, so a minute left leaves the handler time to answer CloudFormation.
const DEADLINE_MARGIN_MS = 60_000;

/** The time the running Lambda invocation has left, as its context reports it. */
export interface InvocationDeadline {
  getRemainingTimeInMillis(): number;
}

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

  /**
   * Returns how many object versions and delete markers were deleted. Stops with an `ExpectedFailure` once the
   * invocation has less than a minute left; what was deleted stays deleted, so a repeated run continues where
   * this one stopped.
   */
  async empty(bucketName: string, deadline: InvocationDeadline): Promise<number> {
    let deleted = 0;
    let position: VersionListingPosition | undefined = {};

    do {
      this.assertTimeLeft(bucketName, deadline, deleted);
      const page = await this.listVersions(bucketName, position);
      deleted += await this.deleteVersions(bucketName, this.identifiersIn(page));
      position = this.nextPosition(page);
    } while (position);

    return deleted;
  }

  private assertTimeLeft(bucketName: string, deadline: InvocationDeadline, deleted: number): void {
    if (deadline.getRemainingTimeInMillis() <= DEADLINE_MARGIN_MS) {
      throw new ExpectedFailure(
        `Bucket ${bucketName} was not fully emptied before the Lambda deadline (${deleted} items deleted so far); retry the delete to continue emptying it`,
      );
    }
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
