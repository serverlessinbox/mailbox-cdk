import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir }                             from 'node:os';
import * as path                              from 'node:path';

import { loadEmbeddedRegistryRecord }         from '../embedded-registry-record';

import { TEST_REGISTRY_RECORD }               from './test-registry-record';

/**
 * Pins that the record at the caller-supplied path is the one loaded, and that a record which
 * cannot be read or fails validation is rejected with an error naming its file. Every artifact
 * location resolves from this record, so a silent fallback here would point deployments at the
 * wrong buckets.
 */
describe('loadEmbeddedRegistryRecord', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'embedded-registry-record-'));

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('loads the record at the given path', () => {
    const filePath = path.join(workDir, 'valid-record.json');
    writeFileSync(filePath, JSON.stringify(TEST_REGISTRY_RECORD));

    expect(loadEmbeddedRegistryRecord(filePath)).toEqual(TEST_REGISTRY_RECORD);
  });

  it('names the file when its content is not a valid registry record', () => {
    const filePath = path.join(workDir, 'invalid-record.json');
    writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, bucketBase: 'mailbox-artifacts' }));

    expect(() => loadEmbeddedRegistryRecord(filePath)).toThrow(filePath);
  });

  it('names the file when it does not exist', () => {
    const filePath = path.join(workDir, 'missing-record.json');

    expect(() => loadEmbeddedRegistryRecord(filePath)).toThrow(`registry record ${filePath}: cannot be read`);
  });
});
