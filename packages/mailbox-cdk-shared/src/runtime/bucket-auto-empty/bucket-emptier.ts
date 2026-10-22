import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  type ListObjectVersionsCommandOutput,
  type ObjectIdentifier,
  type S3Client,
} from '@aws-sdk/client-s3';

import { ExpectedFailure }                      from '../../runtime/handler-kit/errors/expected-failure';
import { hasTimeLeft, type InvocationDeadline } from '../../runtime/handler-kit/invocation-deadline';

const DELETE_OBJECTS_BATCH_SIZE = 1000;

// S3 reports the failure of single objects inside a DeleteObjects call that succeeded. A transient one
// (SlowDown, InternalError) clears within a retry or two; a permanent one (AccessDenied, an object lock)
// never does, so more attempts would only delay the failure.
const DELETE_ATTEMPTS = 3;

/** Where a page of a bucket's object versions starts; empty for the first page. */
interface VersionListingPosition {
  readonly keyMarker?:       string;
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
   * invocation is short of time, or when S3 still refuses to delete some versions after retrying them; what
   * was deleted stays deleted, so a repeated run continues where this one stopped.
   */
  async empty(bucketName: string, deadline: InvocationDeadline): Promise<number> {
    let deleted                                      = 0;
    let position: VersionListingPosition | undefined = {};

    do {
      this.assertTimeLeft(bucketName, deadline, deleted);
      const page = await this.listVersions(bucketName, position);
      deleted   += await this.deleteVersions(bucketName, this.identifiersIn(page), deadline);
      position   = this.nextPosition(page);
    } while (position);

    return deleted;
  }

  private assertTimeLeft(bucketName: string, deadline: InvocationDeadline, deleted: number): void {
    if (!hasTimeLeft(deadline)) {
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
        Bucket:          bucketName,
        KeyMarker:       position.keyMarker,
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

  private async deleteVersions(
    bucketName: string,
    identifiers: ObjectIdentifier[],
    deadline: InvocationDeadline,
  ): Promise<number> {
    let deleted = 0;

    for (let start = 0; start < identifiers.length; start += DELETE_OBJECTS_BATCH_SIZE) {
      const batch = identifiers.slice(start, start + DELETE_OBJECTS_BATCH_SIZE);
      await this.deleteBatchWithRetries(bucketName, batch, deadline);
      deleted += batch.length;
    }

    return deleted;
  }

  // A bucket that still holds a version cannot be deleted, so a version S3 keeps refusing fails the Delete.
  private async deleteBatchWithRetries(
    bucketName: string,
    batch: ObjectIdentifier[],
    deadline: InvocationDeadline,
  ): Promise<void> {
    let undeleted = batch;
    let attempts  = 0;

    while (undeleted.length > 0 && attempts < DELETE_ATTEMPTS && (attempts === 0 || hasTimeLeft(deadline))) {
      undeleted = await this.sendDelete(bucketName, undeleted);
      attempts += 1;
    }

    if (undeleted.length > 0) {
      throw new ExpectedFailure(
        `Bucket ${bucketName} could not be emptied: ${undeleted.length} object versions were still not deleted after ${attempts} attempts`,
      );
    }
  }

  private async sendDelete(bucketName: string, identifiers: ObjectIdentifier[]): Promise<ObjectIdentifier[]> {
    const response = await this.s3.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: identifiers, Quiet: true },
      }),
    );

    return (response.Errors ?? []).flatMap((error) =>
      error.Key ? [{ Key: error.Key, VersionId: error.VersionId }] : [],
    );
  }

  private nextPosition(page: ListObjectVersionsCommandOutput): VersionListingPosition | undefined {
    if (!page.IsTruncated || !page.NextKeyMarker) {
      return undefined;
    }
    return { keyMarker: page.NextKeyMarker, versionIdMarker: page.NextVersionIdMarker };
  }
}
