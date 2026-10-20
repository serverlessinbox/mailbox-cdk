import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir }                     from 'node:os';
import * as path                      from 'node:path';

import { ExternalPinsReader }         from '../external-pins-reader';

/**
 * Pins that the output of `resolve-artifacts` is read in the `{ version, zone }` shape and that
 * a file in any other shape is rejected naming it. The flat `key -> version` map of earlier CLI
 * releases must not slip through into a baked file.
 */
describe('ExternalPinsReader', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'external-pins-reader-'));
  const reader  = new ExternalPinsReader();

  it('reads the pins resolve-artifacts wrote', async () => {
    const pinsFile = path.join(workDir, 'resolved.json');
    const pins     = { 'mailbox-go': { version: '1.2.3', zone: 'regional' } };
    writeFileSync(pinsFile, JSON.stringify(pins));

    expect(await reader.readExternalPins(pinsFile)).toEqual(pins);
  });

  it('names the file when it does not exist', async () => {
    const pinsFile = path.join(workDir, 'missing.json');

    await expect(reader.readExternalPins(pinsFile)).rejects.toThrow(`external pins ${pinsFile}: cannot be read`);
  });

  it('names the file when it is the flat key to version map', async () => {
    const pinsFile = path.join(workDir, 'flat.json');
    writeFileSync(pinsFile, JSON.stringify({ 'mailbox-go': '1.2.3' }));

    await expect(reader.readExternalPins(pinsFile)).rejects.toThrow(pinsFile);
  });
});
