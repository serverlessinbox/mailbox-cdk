import { mkdtemp, realpath, rm }  from 'fs/promises';
import { tmpdir }                 from 'os';
import { join }                   from 'path';

import { runWithInheritedStdio }  from '../run-process';

describe('runWithInheritedStdio', () => {
  it('resolves with 0 when the child exits cleanly', async () => {
    await expect(runWithInheritedStdio(process.execPath, ['-e', 'process.exit(0)'])).resolves.toBe(0);
  });

  it('resolves with the exit code of a child that fails', async () => {
    await expect(runWithInheritedStdio(process.execPath, ['-e', 'process.exit(3)'])).resolves.toBe(3);
  });

  it('resolves with null when the child is killed by a signal', async () => {
    await expect(runWithInheritedStdio(process.execPath, ['-e', 'process.kill(process.pid, "SIGKILL")'])).resolves.toBeNull();
  });

  it('rejects when the command cannot be started', async () => {
    await expect(runWithInheritedStdio('mailbox-bundler-no-such-command', [])).rejects.toThrow('ENOENT');
  });

  it('runs the child in the given working directory', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'run-process-test-'));
    try {
      const expectedCwd = await realpath(folder);
      const script      = 'process.exit(process.cwd() === process.argv[1] ? 0 : 5)';

      await expect(runWithInheritedStdio(process.execPath, ['-e', script, expectedCwd], folder)).resolves.toBe(0);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
