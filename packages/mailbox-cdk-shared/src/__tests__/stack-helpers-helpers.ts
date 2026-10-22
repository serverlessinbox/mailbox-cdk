import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver }               from '@serverlessinbox/artifact-registry-cdk';
import * as cdk                                 from 'aws-cdk-lib';
import { BootstraplessSynthesizer }             from 'aws-cdk-lib';

export interface StackWithResolver {
  readonly stack:    cdk.Stack;
  readonly resolver: IArtifactResolver;
}

/**
 * A bootstrapless stack with an explicit environment, and an artifact resolver that pins
 * `mailbox-cdk-shared`, the package the stack-helpers Lambda is loaded from.
 */
export function createStackWithResolver(): StackWithResolver {
  const stack    = new cdk.Stack(new cdk.App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const resolver = new PinnedArtifactResolver({
    packages:         { 'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  return { stack, resolver };
}
