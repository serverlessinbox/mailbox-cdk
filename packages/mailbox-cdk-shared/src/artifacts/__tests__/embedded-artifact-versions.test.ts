import { mkdtempSync, writeFileSync }   from 'node:fs';
import { tmpdir }                       from 'node:os';
import * as path                        from 'node:path';

import { loadEmbeddedArtifactVersions } from '../embedded-artifact-versions';

/**
 * Pins that the versions file at the caller-supplied path is the one loaded, and that a file which
 * cannot be read or fails validation is rejected with an error naming it. Every package version a
 * construct resolves comes from this file, so a silent fallback here would deploy the wrong artifacts.
 */
describe('loadEmbeddedArtifactVersions', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'embedded-artifact-versions-'));

  it('loads the pins at the given path', () => {
    const filePath = path.join(workDir, 'valid-versions.json');
    const versions = {
      'mailbox-go':       { version: '1.2.3', zone: 'regional' },
      'mailbox-cdk-edge': { version: '1.2.3', zone: 'edge' },
    };
    writeFileSync(filePath, JSON.stringify(versions));

    expect(loadEmbeddedArtifactVersions(filePath)).toEqual(versions);
  });

  it('names the file when its content is not a valid set of pins', () => {
    const filePath = path.join(workDir, 'invalid-versions.json');
    writeFileSync(filePath, JSON.stringify({ 'mailbox-go': { version: '1.2.3' } }));

    expect(() => loadEmbeddedArtifactVersions(filePath)).toThrow(filePath);
  });

  it('names the file when it does not exist', () => {
    const filePath = path.join(workDir, 'missing-versions.json');

    expect(() => loadEmbeddedArtifactVersions(filePath)).toThrow(`artifact versions ${filePath}: cannot be read`);
  });
});
