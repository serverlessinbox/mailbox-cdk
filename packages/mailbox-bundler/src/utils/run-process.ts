import { spawn } from 'child_process';

/**
 * Runs a command with its stdio attached to this process and resolves with its exit code
 * (null when it was killed by a signal). Rejects only when the process cannot be started;
 * judging a non-zero exit is left to the caller.
 */
export function runWithInheritedStdio(command: string, args: string[], cwd?: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', resolve);
  });
}
