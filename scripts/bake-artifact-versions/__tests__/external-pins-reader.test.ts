import { mkdtempSync }        from 'node:fs';
import { tmpdir }             from 'node:os';
import * as path              from 'node:path';

import { ExternalPinsReader } from '../external-pins-reader';

/**
 * Pins that a pins file which cannot be read is rejected naming that file. The accepted shape of
 * the pins is the artifact registry's contract and is tested in its own suite.
 */
describe('ExternalPinsReader', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'external-pins-reader-'));
  const reader  = new ExternalPinsReader();

  it('names the file when it does not exist', async () => {
    const pinsFile = path.join(workDir, 'missing.json');

    await expect(reader.readExternalPins(pinsFile)).rejects.toThrow(`external pins ${pinsFile}: cannot be read`);
  });
});
