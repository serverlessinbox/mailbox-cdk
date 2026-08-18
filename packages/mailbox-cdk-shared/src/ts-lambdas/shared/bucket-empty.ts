import {
  S3Client,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  type ListObjectVersionsCommandOutput,
} from '@aws-sdk/client-s3';

const s3 = new S3Client();

/**
 * List all object versions (including DeleteMarkers) in a bucket and delete them all.
 *
 * Paginates through ListObjectVersions using NextKeyMarker and NextVersionIdMarker,
 * then batch-deletes all objects and versions in chunks of up to 1000 (AWS limit).
 *
 * Returns the total number of items deleted (objects + versions + delete markers).
 */
export async function emptyBucket(bucketName: string): Promise<number> {
  let deleted = 0;
  let keyMarker: string | undefined = undefined;
  let versionIdMarker: string | undefined = undefined;

  do {
    const response: ListObjectVersionsCommandOutput = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucketName,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    );

    // Collect all versions and delete markers from this page
    const itemsToDelete = [];

    // Process Versions (actual object versions)
    if (response.Versions) {
      for (const version of response.Versions) {
        if (version.Key && version.VersionId) {
          itemsToDelete.push({
            Key: version.Key,
            VersionId: version.VersionId,
          });
        }
      }
    }

    // Process DeleteMarkers (metadata-only entries left when an object is deleted)
    if (response.DeleteMarkers) {
      for (const marker of response.DeleteMarkers) {
        if (marker.Key && marker.VersionId) {
          itemsToDelete.push({
            Key: marker.Key,
            VersionId: marker.VersionId,
          });
        }
      }
    }

    // Batch delete in chunks of up to 1000 (AWS limit)
    if (itemsToDelete.length > 0) {
      for (let i = 0; i < itemsToDelete.length; i += 1000) {
        const batch = itemsToDelete.slice(i, i + 1000);
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: {
              Objects: batch,
              Quiet: true,
            },
          }),
        );
        deleted += batch.length;
      }
    }

    // Check if there are more results
    if (response.IsTruncated) {
      keyMarker = response.NextKeyMarker;
      versionIdMarker = response.NextVersionIdMarker;
    } else {
      break;
    }
  } while (keyMarker);

  return deleted;
}
