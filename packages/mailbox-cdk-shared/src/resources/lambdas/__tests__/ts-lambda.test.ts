/// <reference types="jest" />

/**
 * Pins what TypeScriptLambda adds to an artifact Lambda: the Node.js 24 runtime, the `index.handler`
 * entry point unless the caller names another, and 512 MB unless the caller sets the memory. A wrong
 * runtime or handler leaves the function unable to start.
 */

import { ArtifactZone, PinnedArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import { Template }                              from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer, Stack }  from 'aws-cdk-lib';

import { TypeScriptLambda }                      from '../ts-lambda';
import type { TypeScriptLambdaProps }            from '../ts-lambda';

function newStack(): Stack {
  return new Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function newTypeScriptLambda(stack: Stack, overrides: Partial<TypeScriptLambdaProps> = {}): TypeScriptLambda {
  const artifactResolver = new PinnedArtifactResolver({
    packages:         { 'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  return new TypeScriptLambda(stack, 'lambda', {
    lambdaId:    'stack-deployer',
    packageName: 'mailbox-cdk',
    pipeline:    'infra',
    artifactResolver,
    ...overrides,
  });
}

describe('TypeScriptLambda', () => {
  it('runs on Node.js 24 with index.handler by default', () => {
    const stack = newStack();

    newTypeScriptLambda(stack);

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Handler: 'index.handler',
    });
  });

  it('uses the caller’s handler when given', () => {
    const stack = newStack();

    newTypeScriptLambda(stack, { handler: 'index.starterHandler' });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', { Handler: 'index.starterHandler' });
  });

  it('gives 512 MB by default', () => {
    const stack = newStack();

    newTypeScriptLambda(stack);

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', { MemorySize: 512 });
  });

  it('gives the caller’s memory size when given', () => {
    const stack = newStack();

    newTypeScriptLambda(stack, { memorySize: 1024 });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', { MemorySize: 1024 });
  });
});
