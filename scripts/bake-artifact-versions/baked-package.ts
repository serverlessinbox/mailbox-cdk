import type { ArtifactPin, ArtifactZone } from '@serverlessinbox/artifact-registry-cdk';

/** The pin of every package, keyed by package name, as stored in an `artifact-versions.json`. */
export type PinsByPackage = { [packageName: string]: ArtifactPin };

/** The packages this repo releases itself, by the name each is pinned under in an `artifact-versions.json`. */
export type BakedArtifactKey = 'mailbox-cdk' | 'mailbox-cdk-edge' | 'mailbox-cdk-shared' | 'mailbox-cognito';

/** A package this repo releases itself, with the package folder whose bumped manifest carries its version. */
export type OwnArtifact = {
  readonly key:               BakedArtifactKey;
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
