import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export type PublishMode = 'release' | 'dev';

export interface PublishBaseOptions {
  bucketBase: string; // e.g. mailbox-artifacts
  region: string; // e.g. us-east-1
  mode: PublishMode;
  version: string; // e.g. 1.4.0
  devTag?: string; // e.g. joost
  profile?: string;
}

export function artifactBucketName(bucketBase: string, region: string): string {
  return `${bucketBase}-${region}`;
}

export function releasePrefix(opts: PublishBaseOptions): string {
  if (opts.mode === 'release') {
    return `mailbox-cdk/v${opts.version}`;
  }
  const tag = (opts.devTag ?? 'dev').trim();
  if (!tag) {
    throw new Error('devTag is required when mode=dev');
  }
  return `mailbox-cdk/dev/${tag}`;
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

export function awsArgs(base: PublishBaseOptions): string[] {
  return base.profile ? ['--profile', base.profile] : [];
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
