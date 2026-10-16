import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';

/** A stack and the artifact resolver pinning `mailbox-cdk-shared`, for building a shared deployer Lambda to read what it renders. */
export interface ProbeStack {
  readonly stack: Stack;
  readonly artifactResolver: IArtifactResolver;
}

/** A fresh stack with an explicit environment, holding nothing, so what a probe renders is all it contains. */
export function newProbeStack(): ProbeStack {
  const stack = new Stack(new App(), 'shared-probe', {
    env: { account: '111122223333', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const artifactResolver = new PinnedArtifactResolver({
    packages: { 'mailbox-cdk-shared': { version: '0.0.1-test', zone: ArtifactZone.REGIONAL } },
    location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  return { stack, artifactResolver };
}
