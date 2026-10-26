import { Cli }                                                                     from 'clipanion';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir }                                                                  from 'node:os';
import * as path                                                                   from 'node:path';
import { Writable }                                                                from 'node:stream';

import { BakeArtifactVersionsCommand }                                             from '../bake-artifact-versions-command';

/**
 * Pins what the command owns: which root it bakes under (`--root`, else the current directory),
 * that it hands `--mailbox-pins` to the mailbox package, and that it reports every file it wrote.
 * The content of each baked file belongs to the baker and `BakedPackages`.
 */
describe('BakeArtifactVersionsCommand', () => {
  const createdFolders: string[] = [];

  function newFolder(prefix: string): string {
    const folder = mkdtempSync(path.join(tmpdir(), prefix));
    createdFolders.push(folder);
    return folder;
  }

  function repositoryRoot(): string {
    const root = newFolder('bake-artifact-versions-command-');
    for (const name of ['mailbox', 'mailbox-cognito', 'mailbox-cdk-shared']) {
      mkdirSync(path.join(root, 'packages', name), { recursive: true });
      writeFileSync(path.join(root, 'packages', name, 'package.json'), JSON.stringify({ name, version: '4.5.6' }));
    }
    return root;
  }

  function writePins(folder: string): string {
    const pinsFile = path.join(folder, 'pins.json');
    writeFileSync(pinsFile, JSON.stringify({ 'mailbox-go': { version: '7.8.9', zone: 'regional' } }));
    return pinsFile;
  }

  async function runCommand(...args: string[]): Promise<{ exitCode: number; stdout: string }> {
    const chunks: string[] = [];
    const stdout           = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const exitCode         = await Cli.from([BakeArtifactVersionsCommand]).run(args, { stdout });
    return { exitCode, stdout: chunks.join('') };
  }

  afterEach(() => {
    jest.restoreAllMocks();
    for (const folder of createdFolders.splice(0)) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  describe('execute', () => {
    it('bakes both packages under --root, hands --mailbox-pins to the mailbox package and reports each file', async () => {
      const root         = repositoryRoot();
      const unrelatedCwd = newFolder('bake-artifact-versions-cwd-');
      const mailboxFile  = path.join(root, 'packages', 'mailbox', 'artifact-versions.json');
      const cognitoFile  = path.join(root, 'packages', 'mailbox-cognito', 'artifact-versions.json');
      jest.spyOn(process, 'cwd').mockReturnValue(unrelatedCwd);

      const run = await runCommand('--mailbox-pins', writePins(root), '--root', root);

      expect(run).toEqual({ exitCode: 0, stdout: `Written: ${mailboxFile}\nWritten: ${cognitoFile}\n` });
      expect(readFileSync(mailboxFile, 'utf8')).toContain('"mailbox-go"');
      expect(readFileSync(cognitoFile, 'utf8')).not.toContain('"mailbox-go"');
    });

    it('bakes the packages under the current directory when --root is not given', async () => {
      const root = repositoryRoot();
      jest.spyOn(process, 'cwd').mockReturnValue(root);

      const run = await runCommand('--mailbox-pins', writePins(root));

      expect(run.exitCode).toBe(0);
      expect(existsSync(path.join(root, 'packages', 'mailbox', 'artifact-versions.json'))).toBe(true);
    });
  });
});
