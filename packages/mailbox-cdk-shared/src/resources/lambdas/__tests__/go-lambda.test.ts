/// <reference types="jest" />

/**
 * Pins what GoLambda adds to an artifact Lambda: the code is the Go package's `bootstrap` binary on the
 * custom runtime, with 640 MB unless the caller sets the memory. A wrong package deploys the wrong code; a
 * wrong runtime or handler leaves the function unable to start.
 */

import { ArtifactZone, PinnedArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                       from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer, Stack }  from 'aws-cdk-lib';

import { GoLambda }                              from '../go-lambda';
import type { GoLambdaProps }                    from '../go-lambda';

function newStack(): Stack {
  return new Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function newGoLambda(stack: Stack, overrides: Partial<GoLambdaProps> = {}): GoLambda {
  const artifactResolver = new PinnedArtifactResolver({
    packages:         { 'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  return new GoLambda(stack, 'lambda', { lambdaId: 'authorizer', pipeline: 'jmap', artifactResolver, ...overrides });
}

describe('GoLambda', () => {
  it('loads its code from the mailbox-go package and runs it as the custom-runtime bootstrap', () => {
    const stack = newStack();

    newGoLambda(stack);

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Code:    { S3Key: Match.stringLikeRegexp('mailbox-go.*lambdas/authorizer\\.zip') },
      Runtime: 'provided.al2023',
      Handler: 'bootstrap',
    });
  });

  it('gives 640 MB by default', () => {
    const stack = newStack();

    newGoLambda(stack);

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', { MemorySize: 640 });
  });

  it('gives the caller’s memory size when given', () => {
    const stack = newStack();

    newGoLambda(stack, { memorySize: 1024 });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', { MemorySize: 1024 });
  });
});
