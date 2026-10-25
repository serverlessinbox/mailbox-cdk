import type { RegistryRecord as RegistryPackageRecord } from '@serverlessinbox/artifact-registry/registry';
import { mkdtempSync, writeFileSync }                   from 'node:fs';
import { tmpdir }                                       from 'node:os';
import * as path                                        from 'node:path';

import { loadEmbeddedRegistryRecord }                   from '../embedded-registry-record';
import type { RegistryRecord }                          from '../registry-record-contract';

import { TEST_REGISTRY_RECORD }                         from './test-registry-record';

const registryPackageToContract = (record: RegistryPackageRecord): RegistryRecord => record;
const contractToRegistryPackage = (record: RegistryRecord): RegistryPackageRecord => record;

/**
 * Pins that the record at the caller-supplied path is the one loaded, and that a record which
 * cannot be read or fails validation is rejected with an error naming its file. Every artifact
 * location resolves from this record, so a silent fallback here would point deployments at the
 * wrong buckets.
 */
describe('loadEmbeddedRegistryRecord', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'embedded-registry-record-'));

  it('loads the record at the given path', () => {
    const filePath = path.join(workDir, 'valid-record.json');
    writeFileSync(filePath, JSON.stringify(TEST_REGISTRY_RECORD));

    expect(loadEmbeddedRegistryRecord(filePath)).toEqual(TEST_REGISTRY_RECORD);
  });

  it('loads a record with every field of the contract, bucket overrides included', () => {
    const filePath                   = path.join(workDir, 'full-record.json');
    const fullRecord: RegistryRecord = { ...TEST_REGISTRY_RECORD, bucketOverrides: { 'eu-west-1': 'custom-bucket' } };
    writeFileSync(filePath, JSON.stringify(fullRecord));

    expect(registryPackageToContract(contractToRegistryPackage(loadEmbeddedRegistryRecord(filePath)))).toEqual(fullRecord);
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
