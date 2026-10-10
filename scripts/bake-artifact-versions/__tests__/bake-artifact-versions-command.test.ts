import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import { Cli } from 'clipanion';
import { BakeArtifactVersionsCommand } from '../bake-artifact-versions-command';

/**
 * Pins the release configuration against the placeholders committed with each package: every own
 * package the release bakes must already be listed there with the zone the construct needs. A
 * mistyped key or zone in the configuration would otherwise only show up in a published package.
 * Also pins that the command bakes both packages from the given root and pins file.
 */
describe('BakeArtifactVersionsCommand', () => {
  const repoRoot = path.join(__dirname, '..', '..', '..');

  describe('bakedPackages', () => {
    const mailboxPinsFile = path.join(repoRoot, 'unused-pins.json');

    it.each(BakeArtifactVersionsCommand.bakedPackages(repoRoot, mailboxPinsFile).map(bakedPackage => [path.basename(path.dirname(bakedPackage.outputFile)), bakedPackage] as const))(
      'bakes %s own packages as its committed placeholder lists them',
      (_name, bakedPackage) => {
        const placeholder = JSON.parse(readFileSync(bakedPackage.outputFile, 'utf8')) as { [key: string]: { zone: string } };

        for (const ownArtifact of bakedPackage.ownArtifacts) {
          expect(placeholder[ownArtifact.key]?.zone).toBe(ownArtifact.zone);
        }
      },
    );
  });

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
      const stdoutStream = new Writable({
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
      expect(JSON.parse(readFileSync(path.join(root, 'packages', 'mailbox', 'artifact-versions.json'), 'utf8'))).toEqual({
        'mailbox-go': { version: '7.8.9', zone: 'regional' },
        'mailbox-cdk': { version: '4.5.6', zone: 'regional' },
        'mailbox-cdk-edge': { version: '4.5.6', zone: 'edge' },
        'mailbox-cdk-shared': { version: '4.5.6', zone: 'regional' },
      });
      expect(JSON.parse(readFileSync(path.join(root, 'packages', 'mailbox-cognito', 'artifact-versions.json'), 'utf8'))).toEqual({
        'mailbox-cognito': { version: '4.5.6', zone: 'regional' },
        'mailbox-cdk-shared': { version: '4.5.6', zone: 'regional' },
      });
      expect(stdout.join('')).toContain(`Written: ${path.join(root, 'packages', 'mailbox', 'artifact-versions.json')}`);
    });
  });
});
