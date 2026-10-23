import { PinnedArtifactResolver }           from '@serverlessinbox/artifact-registry-cdk';
import { writeFile }                        from 'node:fs/promises';

import type { BakedPackage, PinsByPackage } from './baked-package';
import type { BumpedVersionReader }         from './bumped-version-reader';
import type { ExternalPinsReader }          from './external-pins-reader';

/**
 * Writes the `artifact-versions.json` a publishable package ships: the externally released
 * packages' pins from their release pointers, plus the packages this repo releases itself at the
 * version the release run's bump assigned. The result is validated as the pin set a construct
 * loads before it is written.
 */
export class ArtifactVersionsBaker {
  constructor(
    private readonly bumpedVersionReader: BumpedVersionReader,
    private readonly externalPinsReader: ExternalPinsReader,
  ) {}

  public async bake(bakedPackage: BakedPackage): Promise<void> {
    const externalPins = await this.readExternalPins(bakedPackage);
    const ownPins      = await this.readOwnPins(bakedPackage);
    this.assertNoOverlap(externalPins, ownPins, bakedPackage.outputFile);

    const text = this.serialisePinSet(externalPins, ownPins);
    this.assertValidPinSet(text, bakedPackage.outputFile);
    await this.writePinSet(bakedPackage.outputFile, text);
  }

  private async readExternalPins(bakedPackage: BakedPackage): Promise<PinsByPackage> {
    if (bakedPackage.externalPinsFile === undefined) {
      return {};
    }
    return this.externalPinsReader.readExternalPins(bakedPackage.externalPinsFile);
  }

  private async readOwnPins(bakedPackage: BakedPackage): Promise<PinsByPackage> {
    const ownPins: PinsByPackage = {};
    for (const ownArtifact of bakedPackage.ownArtifacts) {
      const version            = await this.bumpedVersionReader.readBumpedVersion(ownArtifact.manifestDirectory);
      ownPins[ownArtifact.key] = { version, zone: ownArtifact.zone };
    }
    return ownPins;
  }

  private assertNoOverlap(externalPins: PinsByPackage, ownPins: PinsByPackage, outputFile: string): void {
    for (const key of Object.keys(ownPins)) {
      // Never let an own package silently replace an external pin of the same name.
      if (key in externalPins) {
        throw new Error(`${outputFile}: '${key}' is both an external pin and an own package`);
      }
    }
  }

  private serialisePinSet(externalPins: PinsByPackage, ownPins: PinsByPackage): string {
    return JSON.stringify({ ...externalPins, ...ownPins }, null, 2) + '\n';
  }

  private assertValidPinSet(text: string, outputFile: string): void {
    PinnedArtifactResolver.parsePins(text, outputFile);
  }

  private async writePinSet(outputFile: string, text: string): Promise<void> {
    await writeFile(outputFile, text);
  }
}
