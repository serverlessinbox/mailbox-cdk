import { parseRegistryRecord } from '@serverlessinbox/artifact-registry/registry';
import { readFileSync }        from 'node:fs';

import type { RegistryRecord } from './registry-record-contract';

/**
 * Loads and validates the registry record committed with a publishable package
 * (`registry-record.json` at the package root): the location of the buckets artifacts are
 * published to. Synchronous because CDK constructors, which resolve artifact locations, are
 * synchronous. The file's location depends on the package it ships in, so the calling package
 * supplies the path.
 *
 * @param filePath the record file to read
 * @returns the validated record
 * @throws an error naming the file when it cannot be read or is not a valid registry record
 */
export function loadEmbeddedRegistryRecord(filePath: string): RegistryRecord {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`registry record ${filePath}: cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseRegistryRecord(text, filePath);
}
