import { spawnSync } from 'child_process';

export type RunOptions = {
	cwd?: string;
};

export function run(cmd: string, args: string[], opts?: RunOptions) {
	const res = spawnSync(cmd, args, {
		stdio: 'inherit',
		cwd: opts?.cwd,
		env: process.env,
	});
	if (res.status !== 0) {
		throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
	}
}

export async function ensureAwsCliAvailable(): Promise<void> {
	const res = spawnSync('aws', ['--version'], { stdio: 'ignore' });
	if (res.status !== 0) {
		throw new Error('AWS CLI is required (expected `aws` in PATH)');
	}
}

export function awsProfileArgs(profile?: string): string[] {
	return profile ? ['--profile', profile] : [];
}

export function trimCsv(value: string): string[] {
	return value
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

