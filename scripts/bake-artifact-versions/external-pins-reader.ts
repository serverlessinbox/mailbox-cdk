import { PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { readFile }               from 'node:fs/promises';

import { errorMessage }           from '../utils/error-message';

import type { PinsByPackage }     from './baked-package';

/**
 * Reads the output of `artifact-registry resolve-artifacts`: the pins of the externally released
 * packages, taken from their release pointers.
 */
export class ExternalPinsReader {
  public async readExternalPins(pinsFile: string): Promise<PinsByPackage> {
    let text: string;
    try {
      text = await readFile(pinsFile, 'utf8');
    } catch (error) {
      throw new Error(`external pins ${pinsFile}: cannot be read: ${errorMessage(error)}`);
    }
    return PinnedArtifactResolver.parsePins(text, pinsFile);
  }
}
