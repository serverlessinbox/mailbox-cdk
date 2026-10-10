import { writeFile } from 'node:fs/promises';
import { PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { BakedPackage, PinsByPackage } from './baked-package';
import type { BumpedVersionReader } from './bumped-version-reader';
import type { ExternalPinsReader } from './external-pins-reader';

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
    const ownPins = await this.readOwnPins(bakedPackage);

    for (const key of Object.keys(ownPins)) {
      if (key in externalPins) {
        throw new Error(`${bakedPackage.outputFile}: '${key}' is both an external pin and an own package`);
      }
    }

    const text = JSON.stringify({ ...externalPins, ...ownPins }, null, 2) + '\n';
    PinnedArtifactResolver.parsePins(text, bakedPackage.outputFile);
    await writeFile(bakedPackage.outputFile, text);
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
      const version = await this.bumpedVersionReader.readBumpedVersion(ownArtifact.manifestDirectory);
      ownPins[ownArtifact.key] = { version, zone: ownArtifact.zone };
    }
    return ownPins;
  }
}
