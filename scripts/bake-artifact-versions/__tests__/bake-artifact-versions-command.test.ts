import { PinnedArtifactResolver }                                           from '@serverlessinbox/artifact-registry-cdk';
import { Cli }                                                              from 'clipanion';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir }                                                           from 'node:os';
import * as path                                                            from 'node:path';
import { Writable }                                                         from 'node:stream';

import { BakeArtifactVersionsCommand }                                      from '../bake-artifact-versions-command';

/**
 * Pins that the command bakes both packages from the given root and pins file, and that it does so
 * from the root alone, never from the current directory.
 */
describe('BakeArtifactVersionsCommand', () => {
  /**
   * The command runs with an empty directory as its working directory, so a `--root` that is
   * ignored in favour of the current directory finds no packages to bake and fails the run rather
   * than overwriting the real `artifact-versions.json` files of this repository's packages.
   */
  describe('execute', () => {
    const originalCwd = process.cwd();
    let emptyCwd: string;

    beforeEach(() => {
      emptyCwd = mkdtempSync(path.join(tmpdir(), 'bake-artifact-versions-cwd-'));
      process.chdir(emptyCwd);
    });

    afterEach(() => {
      process.chdir(originalCwd);
    });

    it('bakes both packages under --root from --mailbox-pins', async () => {
      const root = mkdtempSync(path.join(tmpdir(), 'bake-artifact-versions-command-'));
      for (const name of ['mailbox', 'mailbox-cognito', 'mailbox-cdk-shared']) {
        mkdirSync(path.join(root, 'packages', name), { recursive: true });
        writeFileSync(path.join(root, 'packages', name, 'package.json'), JSON.stringify({ name, version: '4.5.6' }));
      }
      const pinsFile = path.join(root, 'pins.json');
      writeFileSync(pinsFile, JSON.stringify({ 'mailbox-go': { version: '7.8.9', zone: 'regional' } }));
      const stdout: string[] = [];
      const stdoutStream     = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          stdout.push(chunk.toString());
          callback();
        },
      });

      const exitCode = await Cli.from([BakeArtifactVersionsCommand]).run(
        ['--mailbox-pins', pinsFile, '--root', root],
        { stdout: stdoutStream },
      );

      expect(exitCode).toBe(0);
      expect(readdirSync(emptyCwd)).toEqual([]);
      expect(readBakedPins(path.join(root, 'packages', 'mailbox', 'artifact-versions.json'))).toEqual({
        'mailbox-go':         { version: '7.8.9', zone: 'regional' },
        'mailbox-cdk':        { version: '4.5.6', zone: 'regional' },
        'mailbox-cdk-edge':   { version: '4.5.6', zone: 'edge' },
        'mailbox-cdk-shared': { version: '4.5.6', zone: 'regional' },
      });
      expect(readBakedPins(path.join(root, 'packages', 'mailbox-cognito', 'artifact-versions.json'))).toEqual({
        'mailbox-cognito':    { version: '4.5.6', zone: 'regional' },
        'mailbox-cdk-shared': { version: '4.5.6', zone: 'regional' },
      });
      expect(stdout.join('')).toContain(`Written: ${path.join(root, 'packages', 'mailbox', 'artifact-versions.json')}`);
    });
  });
});

/** Reads a baked file through PinnedArtifactResolver.parsePins, the validation the baker applies before it writes. */
function readBakedPins(file: string) {
  return PinnedArtifactResolver.parsePins(readFileSync(file, 'utf8'), file);
}
