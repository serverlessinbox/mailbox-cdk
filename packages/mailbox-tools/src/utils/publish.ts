import * as fs from 'fs';
import * as path from 'path';
import { artifactBucketName, packagePrefix, type PublishTarget, publishConfig } from '../publish-config';
import { awsProfileArgs, run, trimCsv } from './common';

export type PublishMode = 'channel' | 'release';

export function resolveRegions(mode: PublishMode, regionsCsv?: string): string[] {
  return mode === 'channel'
    ? publishConfig.channel.regions.slice()
    : trimCsv(regionsCsv ?? publishConfig.release.regions.join(','));
}

export function resolveTarget(mode: PublishMode, opts: { version?: string; channel?: string }): PublishTarget {
  if (mode === 'release') {
    const version = (opts.version ?? '').trim();
    if (!version) {
      throw new Error('--version is required when --mode release');
    }
    return { kind: 'release', version };
  }

  const channel = (opts.channel ?? '').trim();
  if (!channel) {
    throw new Error('--channel is required when --mode channel');
  }
  return { kind: 'channel', channel };
}

export function resolveFilePath(filePath: string, label: string): string {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new Error(`${label} is not a file: ${resolved}`);
  }
  return resolved;
}

export function resolveDirPath(dirPath: string, label: string): string {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`${label} is not a directory: ${resolved}`);
  }
  return resolved;
}

export function uploadFileToRegions(args: {
  packageName: string;
  target: PublishTarget;
  objectName: string;
  filePath: string;
  regions: string[];
  awsProfile?: string;
  log: (msg: string) => void;
}): void {
  const prefix = packagePrefix(args.packageName, args.target);

  for (const region of args.regions) {
    const bucket = artifactBucketName(publishConfig.bucketBase, region);
    const s3Key = `${prefix}/${args.objectName}`;

    args.log(`Uploading ${args.filePath} -> s3://${bucket}/${s3Key}`);
    run('aws', [
      ...awsProfileArgs(args.awsProfile),
      's3',
      'cp',
      args.filePath,
      `s3://${bucket}/${s3Key}`,
      '--region',
      region,
    ]);
  }
}
