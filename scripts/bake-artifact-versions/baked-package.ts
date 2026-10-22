import type { ArtifactPin, ArtifactZone } from '@serverlessinbox/artifact-registry-cdk';

/** The pin of every package, keyed by package name, as stored in an `artifact-versions.json`. */
export type PinsByPackage = { [packageName: string]: ArtifactPin };

/** A package this repo releases itself, with the package folder whose bumped manifest carries its version. */
export type OwnArtifact = {
  readonly key:               string;
  readonly zone:              ArtifactZone;
  readonly manifestDirectory: string;
};

/**
 * One publishable package and the `artifact-versions.json` it ships: the file to write, the
 * `resolve-artifacts` output holding the externally released packages it needs (absent when it
 * needs none), and the packages this repo releases itself.
 */
export type BakedPackage = {
  readonly outputFile:        string;
  readonly externalPinsFile?: string;
  readonly ownArtifacts:      readonly OwnArtifact[];
};
