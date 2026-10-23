import { ArtifactZone }                                                    from '@serverlessinbox/artifact-registry-cdk';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir }                                                          from 'node:os';
import * as path                                                           from 'node:path';

import { ArtifactVersionsBaker }                                           from '../artifact-versions-baker';
import type { BakedPackage, PinsByPackage }                                from '../baked-package';
import { BumpedVersionReader }                                             from '../bumped-version-reader';
import { ExternalPinsReader }                                              from '../external-pins-reader';

/**
 * Pins the file a published package ships: its own packages carry the version the bump wrote into
 * their manifests, externally released packages carry the pointer versions, and nothing invalid
 * reaches disk. A wrong entry here deploys customers onto an artifact version that does not match
 * the package they installed.
 */
describe('ArtifactVersionsBaker', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'artifact-versions-baker-'));
  const baker   = new ArtifactVersionsBaker(new BumpedVersionReader(), new ExternalPinsReader());

  function bumpedManifestDirectory(name: string, version: string): string {
    const directory = path.join(workDir, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version }));
    return directory;
  }

  function externalPinsFile(name: string, pins: PinsByPackage): string {
    const pinsFile = path.join(workDir, `${name}-external.json`);
    writeFileSync(pinsFile, JSON.stringify(pins));
    return pinsFile;
  }

  function readBaked(bakedPackage: BakedPackage): unknown {
    return JSON.parse(readFileSync(bakedPackage.outputFile, 'utf8')) as unknown;
  }

  it('merges the external pins with own packages at their bumped versions', async () => {
    const bakedPackage: BakedPackage = {
      outputFile:       path.join(workDir, 'merged.json'),
      externalPinsFile: externalPinsFile('merged', { 'mailbox-go': { version: '3.1.4', zone: ArtifactZone.REGIONAL } }),
      ownArtifacts:     [
        { key: 'mailbox-cdk', zone: ArtifactZone.REGIONAL, manifestDirectory: bumpedManifestDirectory('merged-app', '0.7.2') },
        { key: 'mailbox-cdk-edge', zone: ArtifactZone.EDGE, manifestDirectory: bumpedManifestDirectory('merged-app', '0.7.2') },
      ],
    };

    await baker.bake(bakedPackage);

    expect(readBaked(bakedPackage)).toEqual({
      'mailbox-go':       { version: '3.1.4', zone: 'regional' },
      'mailbox-cdk':      { version: '0.7.2', zone: 'regional' },
      'mailbox-cdk-edge': { version: '0.7.2', zone: 'edge' },
    });
  });

  it('bakes only the own packages when the package has no external pins file', async () => {
    const bakedPackage: BakedPackage = {
      outputFile:   path.join(workDir, 'own-only.json'),
      ownArtifacts: [
        { key: 'mailbox-cognito', zone: ArtifactZone.REGIONAL, manifestDirectory: bumpedManifestDirectory('own-only-app', '1.0.9') },
      ],
    };

    await baker.bake(bakedPackage);

    expect(readBaked(bakedPackage)).toEqual({ 'mailbox-cognito': { version: '1.0.9', zone: 'regional' } });
  });

  it('replaces the placeholder already in the output file', async () => {
    const outputFile = path.join(workDir, 'placeholder.json');
    writeFileSync(outputFile, JSON.stringify({ 'mailbox-cognito': { version: '0.0.0', zone: 'regional' } }));
    const bakedPackage: BakedPackage = {
      outputFile,
      ownArtifacts: [
        { key: 'mailbox-cognito', zone: ArtifactZone.REGIONAL, manifestDirectory: bumpedManifestDirectory('placeholder-app', '2.5.3') },
      ],
    };

    await baker.bake(bakedPackage);

    expect(readBaked(bakedPackage)).toEqual({ 'mailbox-cognito': { version: '2.5.3', zone: 'regional' } });
  });

  it('rejects a package that is both an external pin and an own package', async () => {
    const bakedPackage: BakedPackage = {
      outputFile:       path.join(workDir, 'collision.json'),
      externalPinsFile: externalPinsFile('collision', { 'mailbox-cdk': { version: '9.9.9', zone: ArtifactZone.REGIONAL } }),
      ownArtifacts:     [
        { key: 'mailbox-cdk', zone: ArtifactZone.REGIONAL, manifestDirectory: bumpedManifestDirectory('collision-app', '0.1.0') },
      ],
    };

    await expect(baker.bake(bakedPackage)).rejects.toThrow(`${bakedPackage.outputFile}: 'mailbox-cdk' is both an external pin and an own package`);
  });

  it('writes nothing when an external pin is not a valid pin', async () => {
    const pinsFile = path.join(workDir, 'invalid-external.json');
    writeFileSync(pinsFile, JSON.stringify({ 'mailbox-go': { version: '3.1.4', zone: 'global' } }));
    const bakedPackage: BakedPackage = {
      outputFile:       path.join(workDir, 'invalid.json'),
      externalPinsFile: pinsFile,
      ownArtifacts:     [
        { key: 'mailbox-cdk', zone: ArtifactZone.REGIONAL, manifestDirectory: bumpedManifestDirectory('invalid-app', '0.1.0') },
      ],
    };

    await expect(baker.bake(bakedPackage)).rejects.toThrow(pinsFile);
    expect(existsSync(bakedPackage.outputFile)).toBe(false);
  });
});
