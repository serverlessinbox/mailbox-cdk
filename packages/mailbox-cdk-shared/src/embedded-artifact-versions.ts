import { PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin }       from '@serverlessinbox/artifact-registry-cdk';
import { readFileSync }           from 'node:fs';

/** The pin of every package a construct resolves, keyed by package name, as shipped in `artifact-versions.json`. */
export type EmbeddedArtifactVersions = { [packageName: string]: ArtifactPin };

/**
 * Loads and validates the artifact versions committed with a publishable package
 * (`artifact-versions.json` at the package root): the version and zone of every package the
 * package's construct resolves. Synchronous because CDK constructors, which resolve artifact
 * locations, are synchronous. The file's location depends on the package it ships in, so the
 * calling package supplies the path.
 *
 * @param filePath the artifact versions file to read
 * @returns the validated pins
 * @throws an error naming the file when it cannot be read or is not a valid set of pins
 */
export function loadEmbeddedArtifactVersions(filePath: string): EmbeddedArtifactVersions {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`artifact versions ${filePath}: cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  return PinnedArtifactResolver.parsePins(text, filePath);
}
