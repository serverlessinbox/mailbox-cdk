/// <reference types="jest" />

/**
 * Pins which release the updater considers newer than a deployed version. A wrong answer here either
 * downgrades a function to an older release or never updates it. The release pointer must be read through the
 * S3 client the class is given: a client built inside it would escape the entry point's single
 * redirect-following client and be rebuilt on every call. The registry package is faked because it reads S3.
 */

import { LoggerBuffer }                                                                          from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { SemVer }                                                                                from 'semver';

import { ReleaseArtifacts }                                                                      from '../release-artifacts';

import { EU_WEST_1, fakeUpdaterClients, lambdaTarget, registryMocks, testConfig, uiTarget }      from './updater-helpers';

jest.mock('@serverlessinbox/artifact-registry', () =>
  (jest.requireActual('./updater-helpers') as typeof import('./updater-helpers')).artifactRegistryModuleMock(),
);

const { readReleasePointer, deriveTrack, buildArtifactKey } = registryMocks();

describe('ReleaseArtifacts', () => {
  const registryS3                                         = fakeUpdaterClients().registryS3;
  const { packageName, deployedVersion: DEPLOYED_VERSION } = lambdaTarget();
  const releases                                           = new ReleaseArtifacts(registryS3, testConfig, new LoggerBuffer());

  beforeEach(() => {
    jest.clearAllMocks();
    deriveTrack.mockReturnValue('v1');
  });

  describe('findNewer', () => {
    it('reads the release pointer of the deployed version\'s track through the S3 client it is given', async () => {
      readReleasePointer.mockResolvedValue({ version: '1.2.4' });

      await releases.findNewer(EU_WEST_1, packageName, DEPLOYED_VERSION);

      expect(deriveTrack).toHaveBeenCalledWith('1.2.3', 'major');
      expect(readReleasePointer).toHaveBeenCalledWith(
        registryS3,
        { bucketBase: 'mailbox-artifacts', project: 'serverlessinbox' },
        'mailbox-go',
        'latest',
        'eu-west-1',
        'v1',
      );
    });

    it('returns the newer version as published and parsed, with the deployed version parsed', async () => {
      readReleasePointer.mockResolvedValue({ version: '1.2.4' });

      const stale = await releases.findNewer(EU_WEST_1, packageName, DEPLOYED_VERSION);

      expect(stale?.version).toBe('1.2.4');
      expect(stale?.parsed.version).toBe('1.2.4');
      expect(stale?.deployed.version).toBe('1.2.3');
    });

    it('returns null when the track has no release pointer', async () => {
      readReleasePointer.mockResolvedValue(null);

      await expect(releases.findNewer(EU_WEST_1, packageName, DEPLOYED_VERSION)).resolves.toBeNull();
    });

    it.each([
      { description: 'the same version', pointerVersion: '1.2.3', deployedVersion: '1.2.3' },
      { description: 'an older version', pointerVersion: '1.2.2', deployedVersion: '1.2.3' },
      { description: 'a pointer that is not a semantic version', pointerVersion: 'not-a-semver', deployedVersion: '1.2.3' },
      { description: 'a deployed version that is not a semantic version', pointerVersion: '1.2.4', deployedVersion: 'not-a-semver' },
    ])('returns null for $description', async ({ pointerVersion, deployedVersion }) => {
      readReleasePointer.mockResolvedValue({ version: pointerVersion });

      await expect(
        releases.findNewer(EU_WEST_1, packageName, lambdaTarget({ deployedVersion }).deployedVersion),
      ).resolves.toBeNull();
    });
  });

  describe('locateLambdaCode', () => {
    it('puts the zip of the function in the artifact bucket of the region, under the key the registry builds for it', () => {
      buildArtifactKey.mockReturnValue('serverlessinbox/packages/mailbox-go/releases/v1.2.4/lambdas/mailbox-go.zip');
      const release = new SemVer('1.2.4');

      const location = releases.locateLambdaCode(EU_WEST_1, lambdaTarget(), release);

      expect(location).toEqual({
        bucket: 'mailbox-artifacts-eu-west-1',
        key:    'serverlessinbox/packages/mailbox-go/releases/v1.2.4/lambdas/mailbox-go.zip',
      });
      expect(buildArtifactKey).toHaveBeenCalledWith('package', 'mailbox-go', {
        type:       'release',
        version:    release,
        objectName: 'lambdas/mailbox-go.zip',
        project:    'serverlessinbox',
      });
    });
  });

  describe('locateUiBundle', () => {
    it('stores the bundle under its artifact name, with no folder of its own', () => {
      buildArtifactKey.mockReturnValue('serverlessinbox/packages/ui-bundle/releases/v1.2.4/ui-bundle.zip');
      const release = new SemVer('1.2.4');

      releases.locateUiBundle(EU_WEST_1, uiTarget(), release);

      expect(buildArtifactKey).toHaveBeenCalledWith('package', 'ui-bundle', {
        type:       'release',
        version:    release,
        objectName: 'ui-bundle.zip',
        project:    'serverlessinbox',
      });
    });
  });
});
