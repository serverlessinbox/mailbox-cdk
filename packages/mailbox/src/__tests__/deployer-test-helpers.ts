import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';

export const TEST_ACCOUNT = '111122223333';
export const TEST_REGION = 'us-west-2';
export const TEST_ARTIFACT_VERSION = '0.0.1-test';

export interface DeployerTestStack {
  readonly stack: Stack;
  readonly artifactResolver: IArtifactResolver;
}

/** A stack with an explicit environment and a resolver pinning every package the sub-stack deployers resolve artifacts from. */
export function newDeployerTestStack(): DeployerTestStack {
  const stack = new Stack(new App(), 'test-stack', {
    env: { account: TEST_ACCOUNT, region: TEST_REGION },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const artifactResolver = new PinnedArtifactResolver({
    packages: {
      mailbox: { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL },
      'mailbox-cdk': { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL },
      'mailbox-cdk-shared': { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL },
      'mailbox-cdk-edge': { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.EDGE },
    },
    location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  return { stack, artifactResolver };
}
