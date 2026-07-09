import {
  S3Client,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import unzipper from 'unzipper';
import { Readable } from 'node:stream';

import { guessContentType } from './ui-content-type';
import { normalizeRelativeKey, normalizePrefix } from './ui-paths';
import { streamToBuffer } from './ui-streams';

export { normalizePrefix };

const s3 = new S3Client({});

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

  let uploaded = 0;
  const zipStream = body instanceof Readable ? body : Readable.from(body as any);
  const directory = zipStream.pipe(unzipper.Parse({ forceStream: true }));

  for await (const entry of directory) {
    const entryPath = entry.path as string;

    if (entry.type === 'Directory') {
      entry.autodrain();
      continue;
    }

    const relative = normalizeRelativeKey(entryPath);
    const key = `${targetPrefix}${relative}`;

    // Don't stream the entry directly into S3 PutObject.
    // The AWS SDK may sign streaming bodies with strict chunking requirements
    // ("Only the last chunk is allowed to have a size less than 8192 bytes").
    // Buffering avoids that failure mode and is fine for UI asset zips.
    const entryBody = await streamToBuffer(entry);

    await s3.send(
      new PutObjectCommand({
        Bucket: targetBucket,
        Key: key,
        Body: entryBody,
        ContentLength: entryBody.length,
        ContentType: guessContentType(key),
      }),
    );

    uploaded += 1;
  }

  return { uploaded };
}

export async function writeConfigJson(params: {
  targetBucket: string;
  configPrefix: string;
  configJson?: string;
}): Promise<{ written: boolean }> {
  const { targetBucket, configPrefix, configJson } = params;
  if (!configJson) return { written: false };

  const key = `${configPrefix}config.json`;

  await s3.send(
    new PutObjectCommand({
      Bucket: targetBucket,
      Key: key,
      Body: configJson,
      ContentType: 'application/json; charset=utf-8',
      CacheControl: 'no-store',
    }),
  );

  return { written: true };
}
