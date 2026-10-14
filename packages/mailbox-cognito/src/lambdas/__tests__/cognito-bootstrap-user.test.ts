/// <reference types="jest" />

/**
 * Pins what the construct of the bootstrap user Lambda gives the function: the timeout and memory it runs with
 * and the one grant it holds for itself. Without `cloudformation:DescribeStacks` on the stack the Lambda cannot
 * tell that its Update failed during a rollback, and answers the failure that strands the stack.
 */

import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { resourcesOf, statementsForAction } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { CognitoBootstrapUserLambda } from '../cognito-bootstrap-user';

describe('CognitoBootstrapUserLambda', () => {
  let template: Template;

  beforeEach(() => {
    const stack = new Stack(new App(), 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const artifactResolver = new PinnedArtifactResolver({
      packages: {
        'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        'mailbox-cognito': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
      },
      location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    new CognitoBootstrapUserLambda(stack, 'bootstrap-user-lambda', { artifactResolver });
    template = Template.fromStack(stack);
  });

  it('runs for two minutes with 256 MB', () => {
    template.hasResourceProperties('AWS::Lambda::Function', { Timeout: 120, MemorySize: 256 });
  });

  it('may describe only the stack it is deployed in', () => {
    const statements = statementsForAction(template, 'cloudformation:DescribeStacks');

    expect(statements.map((statement) => resourcesOf(statement))).toEqual([[{ Ref: 'AWS::StackId' }]]);
  });
});
