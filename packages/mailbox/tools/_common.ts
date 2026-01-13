import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export type PublishTarget =
  | {
    kind: 'release';
    version: string; // e.g. 1.4.0 (no leading v)
  }
  | {
    kind: 'channel';
    channel: string; // e.g. main, staging, dev
  };

export interface ArtifactReference {
  /** Artifact path relative to the publish target prefix, e.g. "template.json" or "lambdas/blob-authorizer.zip" */
  readonly key: string;

  /** Optional S3 object version ID */
  readonly s3VersionId?: string;
}

export interface PublishOptions {
  bucketBase: string; // e.g. mailbox-artifacts
  region: string; // e.g. us-east-1
  target: PublishTarget;
  profile?: string;
}

export function artifactBucketName(bucketBase: string, region: string): string {
  return `${bucketBase}-${region}`;
}

export function artifactPrefix(target: PublishTarget, packageName: string = 'mailbox-cdk'): string {
  if (target.kind === 'release') {
    if (!target.version || target.version.trim() === '') {
      throw new Error('version is required when kind=release');
    }
    return `packages/${packageName}/v${target.version}`;
  }

  const channel = target.channel.trim();
  if (!channel) {
    throw new Error('channel is required when kind=channel');
  }
  return `packages/${packageName}/channels/${channel}`;
}

export function edgeArtifactPrefix(target: PublishTarget): string {
  return artifactPrefix(target, 'mailbox-cdk-edge');
}

export function artifactUrl(
  bucket: string,
  target: PublishTarget,
  reference: ArtifactReference,
): string {
  const prefix = artifactPrefix(target);
  const fullKey = `${prefix}/${reference.key}`;
  let url = `https://${bucket}.s3.amazonaws.com/${fullKey}`;
  if (reference.s3VersionId) {
    url += `?versionId=${reference.s3VersionId}`;
  }
  return url;
}

export function run(cmd: string, args: string[], opts?: { cwd?: string }) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: opts?.cwd,
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

export function awsArgs(opts: PublishOptions): string[] {
  return opts.profile ? ['--profile', opts.profile] : [];
}

export function ensureAwsCliAvailable() {
  const res = spawnSync('aws', ['--version'], { stdio: 'ignore' });
  if (res.status !== 0) {
    throw new Error('AWS CLI is required (expected `aws` in PATH)');
  }
}

export function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
}

export function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export function requireString(args: Record<string, string | boolean>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`Missing required flag --${key}`);
  }
  return v;
}

export function optionalString(args: Record<string, string | boolean>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}
