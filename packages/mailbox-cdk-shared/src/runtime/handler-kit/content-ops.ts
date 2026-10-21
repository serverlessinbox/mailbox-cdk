/// <reference types="node" />

import type { S3Client }                   from '@aws-sdk/client-s3';
import type { ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import mime                   from 'mime-types';
import { posix as pathPosix } from 'node:path';
import unzipper               from 'unzipper';

const S3_DELETE_OBJECTS_LIMIT = 1000;

/** The zip object to unpack and the bucket and prefix its entries are written under. */
export interface ZipDeployment {
  readonly sourceBucket: string;
  readonly sourceKey: string;
  readonly sourceVersionId?: string;
  readonly targetBucket: string;
  readonly targetPrefix: string;
}

/** How many entries of a zip were written. */
export interface ZipDeploymentResult {
  readonly uploaded: number;
}

/** One object to write: its key, its body and the optional headers it is stored with. */
export interface ObjectWrite {
  readonly targetBucket: string;
  readonly key: string;
  readonly body: string;
  readonly contentType?: string;
  readonly cacheControl?: string;
}

/** Deletes every object under the prefix and returns how many it deleted. */
export async function deletePrefix(s3: S3Client, bucket: string, prefix: string): Promise<number> {
  let deleted                   = 0;
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

    if (keys.length === 0) {
      break;
    }

    for (let i = 0; i < keys.length; i += S3_DELETE_OBJECTS_LIMIT) {
      const batch: string[] = keys.slice(i, i + S3_DELETE_OBJECTS_LIMIT);
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

/**
 * Unpacks the zip object and writes each file entry under the target prefix, with the content type its
 * extension implies. Directory entries are skipped. Throws when the zip object has no body or an entry
 * path leaves the prefix.
 */
export async function deployZipToPrefix(s3: S3Client, deployment: ZipDeployment): Promise<ZipDeploymentResult> {
  const { sourceBucket, sourceKey, sourceVersionId, targetBucket, targetPrefix } = deployment;

  const directory = await readZipDirectory(s3, sourceBucket, sourceKey, sourceVersionId);

  let uploaded = 0;
  for (const file of directory.files) {
    if (file.type === 'Directory') {
      continue;
    }

    const key = `${targetPrefix}${normalizeRelativeKey(file.path)}`;
    await uploadZipEntry(s3, targetBucket, key, file);
    uploaded += 1;
  }

  return { uploaded };
}

/** Writes one object. */
export async function writeObject(s3: S3Client, write: ObjectWrite): Promise<void> {
  const { targetBucket, key, body, contentType, cacheControl } = write;

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

/**
 * Reads the whole zip object into memory and opens it for random access by entry. The UI zips are small, and
 * the streaming alternatives fail outside any try/catch: `.pipe()` does not forward source-stream errors, so
 * an error on the S3 body has no listener and ends the process, and `unzipper.Parse` consumed with `for await`
 * can leave its last iterator promise unsettled so the event loop empties and Node exits. Either one crashes
 * the Lambda with NodeJsExit.
 */
async function readZipDirectory(
  s3: S3Client,
  sourceBucket: string,
  sourceKey: string,
  sourceVersionId: string | undefined,
): Promise<unzipper.CentralDirectory> {
  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: sourceBucket,
      Key: sourceKey,
      VersionId: sourceVersionId,
    }),
  );

  const body = obj.Body;
  if (!body) {
    throw new Error('S3 GetObject returned empty body');
  }

  const zipBuffer = Buffer.from(await body.transformToByteArray());
  return unzipper.Open.buffer(zipBuffer);
}

/**
 * Writes one zip entry, buffered and not streamed into PutObject: the AWS SDK can sign a streaming body with
 * strict chunking requirements ("Only the last chunk is allowed to have a size less than 8192 bytes").
 */
async function uploadZipEntry(
  s3: S3Client,
  targetBucket: string,
  key: string,
  file: unzipper.File,
): Promise<void> {
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
}

/**
 * Normalizes the path of a zip entry into the key it is written under, relative to a target prefix.
 * Throws for a path that is empty or leaves the prefix (`..`), and for one containing `:` (a Windows drive).
 */
function normalizeRelativeKey(input: string): string {
  const trimmed        = (input ?? '').toString().trim();
  const withoutLeading = trimmed.replace(/^\/+/, '');
  const normalized     = pathPosix.normalize(withoutLeading);

  if (normalized === '.' || normalized.startsWith('..') || normalized.includes(':')) {
    throw new Error(`Invalid relative key: ${input}`);
  }

  return normalized;
}

/**
 * The `Content-Type` an object with this key is stored with, or undefined when the extension is unknown.
 * Text, JavaScript and JSON types carry `charset=utf-8`.
 */
function guessContentType(key: string): string | undefined {
  const contentType = mime.lookup(key);
  if (!contentType) {
    return undefined;
  }

  if (contentType.startsWith('text/') || contentType === 'application/javascript' || contentType === 'application/json') {
    return `${contentType}; charset=utf-8`;
  }

  return contentType;
}
