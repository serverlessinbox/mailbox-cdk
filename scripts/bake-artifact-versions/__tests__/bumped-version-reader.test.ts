import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { BumpedVersionReader } from '../bumped-version-reader';

/**
 * Pins that the version baked into a package is exactly the one the bump wrote into its manifest,
 * and that a manifest the bump did not reach is rejected naming the file. A defaulted version
 * would bake an entry that points at an artifact the run never published.
 */
describe('BumpedVersionReader', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'bumped-version-reader-'));
  const reader = new BumpedVersionReader();

  function packageDirectory(name: string, manifest: string): string {
    const directory = path.join(workDir, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), manifest);
    return directory;
  }

  it('returns the manifest version', async () => {
    const directory = packageDirectory('bumped', JSON.stringify({ name: 'x', version: '0.4.17' }));

    expect(await reader.readBumpedVersion(directory)).toBe('0.4.17');
  });

  it('names the manifest when the folder has none', async () => {
    const directory = path.join(workDir, 'absent');

    await expect(reader.readBumpedVersion(directory)).rejects.toThrow(`${path.join(directory, 'package.json')}: cannot be read`);
  });

  it('names the manifest when it has no version', async () => {
    const directory = packageDirectory('unversioned', JSON.stringify({ name: 'x' }));

    await expect(reader.readBumpedVersion(directory)).rejects.toThrow(`${path.join(directory, 'package.json')}: has no semver "version"`);
  });

  it('names the manifest when the version is not semver', async () => {
    const directory = packageDirectory('not-semver', JSON.stringify({ name: 'x', version: 'latest' }));

    await expect(reader.readBumpedVersion(directory)).rejects.toThrow(`${path.join(directory, 'package.json')}: has no semver "version"`);
  });
});
