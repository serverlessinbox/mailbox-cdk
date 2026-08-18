/// <reference types="node" />

import {
  S3Client,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import unzipper from 'unzipper';

import { guessContentType } from './ui-content-type';
import { normalizeRelativeKey, normalizePrefix } from './ui-paths';

export { normalizePrefix };

const s3 = new S3Client();

export async function deletePrefix(bucket: string, prefix: string): Promise<number> {
  let deleted = 0;
  let token: string | undefined = undefined;

  do {
    const list: ListObjectsV2CommandOutput = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );

    const keys = (list.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => typeof k === 'string');

    if (keys.length === 0) break;

    // DeleteObjects caps at 1000 keys.
    for (let i = 0; i < keys.length; i += 1000) {
      const batch: string[] = keys.slice(i, i + 1000);
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch.map((Key: string) => ({ Key })),
            Quiet: true,
          },
        }),
      );
      deleted += batch.length;
    }

    token = list.NextContinuationToken;
  } while (token);

  return deleted;
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

export async function deployZipToPrefix(params: {
  sourceBucket: string;
  sourceKey: string;
  sourceVersionId?: string;
  targetBucket: string;
  targetPrefix: string;
}): Promise<{ uploaded: number }> {
  const { sourceBucket, sourceKey, sourceVersionId, targetBucket, targetPrefix } = params;

  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: sourceBucket,
      Key: sourceKey,
      VersionId: sourceVersionId,
    }),
  );

  const body = obj.Body;
  if (!body) throw new Error('S3 GetObject returned empty body');

  // Buffer the entire (small) UI zip, then read entries via random access.
  // This avoids two issues with the streaming pipe + for-await approach:
  // 1. .pipe() does NOT forward source-stream errors, so errors on zipStream
  //    (the S3 body) emit with no listener → uncaught exception → process exit
  // 2. unzipper.Parse with forceStream consumed via for-await can leave the
  //    final iterator promise unsettled → event loop empties → Node exits
  // Both bypass the try/catch → Lambda NodeJsExit crash.
  const zipBuffer = Buffer.from(await body.transformToByteArray());
  const directory = await unzipper.Open.buffer(zipBuffer);

  let uploaded = 0;
  for (const file of directory.files) {
    if (file.type === 'Directory') continue;

    const relative = normalizeRelativeKey(file.path);
    const key = `${targetPrefix}${relative}`;

    // Don't stream the entry directly into S3 PutObject.
    // The AWS SDK may sign streaming bodies with strict chunking requirements
    // ("Only the last chunk is allowed to have a size less than 8192 bytes").
    // Buffering avoids that failure mode and is fine for UI asset zips.
    const content = await file.buffer();

    await s3.send(
      new PutObjectCommand({
        Bucket: targetBucket,
        Key: key,
        Body: content,
        ContentLength: content.length,
        ContentType: guessContentType(key),
      }),
    );

    uploaded += 1;
  }

  return { uploaded };
}

export async function writeObject(params: {
  targetBucket: string;
  key: string;
  body: string;
  contentType?: string;
  cacheControl?: string;
}): Promise<void> {
  const { targetBucket, key, body, contentType, cacheControl } = params;

  await s3.send(
    new PutObjectCommand({
      Bucket: targetBucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
}
