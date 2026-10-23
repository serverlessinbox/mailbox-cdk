import { spawnSync }   from 'node:child_process';
import * as fileSystem from 'node:fs';
import { tmpdir }      from 'node:os';
import * as path       from 'node:path';

export function run(cmd: string, args: string[], opts?: { cwd?: string }) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd:   opts?.cwd,
    env:   process.env,
  });
  if (res.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

export function awsArgs(opts: { profile?: string }): string[] {
  return opts.profile ? ['--profile', opts.profile] : [];
}

export function ensureAwsCliAvailable() {
  const res = spawnSync('aws', ['--version'], { stdio: 'ignore' });
  if (res.status !== 0) {
    throw new Error('AWS CLI is required (expected `aws` in PATH)');
  }
}

export function mkTempDir(prefix: string): string {
  const dir = fileSystem.mkdtempSync(path.join(tmpdir(), prefix));
  return dir;
}

export function writeJson(filePath: string, value: unknown) {
  fileSystem.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key  = arg.slice(2);
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
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required flag --${key}`);
  }
  return value;
}

export function optionalString(args: Record<string, string | boolean>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
