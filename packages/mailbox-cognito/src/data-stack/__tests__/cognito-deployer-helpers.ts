import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver }               from '@serverlessinbox/artifact-registry-cdk';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

export const TEST_ARTIFACT_VERSION = '0.0.1-test';

export interface DeployerTestStack {
  readonly stack:            Stack;
  readonly artifactResolver: IArtifactResolver;
}

/** A stack with an explicit environment and a resolver pinning the packages the cognito deployer resolves artifacts from. */
export function newDeployerTestStack(): DeployerTestStack {
  const stack            = new Stack(new App(), 'test-stack', {
    env:         { account: '111122223333', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const artifactResolver = new PinnedArtifactResolver({
    packages:         {
      'mailbox-cognito':    { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL },
      'mailbox-cdk-shared': { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL },
    },
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  return { stack, artifactResolver };
}
