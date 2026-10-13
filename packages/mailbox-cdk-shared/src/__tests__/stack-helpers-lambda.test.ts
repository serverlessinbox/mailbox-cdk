/// <reference types="jest" />

/**
 * Pins the deployed shape of the stack-helpers Lambda: it runs the stack-helpers bundle and may call
 * Route 53 GetHostedZone, the only AWS call its handler makes. Without that grant every lookup fails
 * at deploy time with AccessDenied, which no synth-time check reports.
 */

import { Match, Template } from 'aws-cdk-lib/assertions';
import { StackHelpersLambda } from '../stack-helpers-lambda';
import { createStackWithResolver } from './stack-helpers-helpers';

describe('StackHelpersLambda', () => {
  const { stack, resolver } = createStackWithResolver();
  new StackHelpersLambda(stack, 'handler', { artifactResolver: resolver });
  const template = Template.fromStack(stack);

  it('loads its code from the stack-helpers bundle of mailbox-cdk-shared', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Code: { S3Key: Match.stringLikeRegexp('lambdas/stack-helpers\\.zip$') },
    });
  });

  it('may read hosted zones', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: Match.arrayWith(['route53:GetHostedZone']),
            Resource: '*',
          }),
        ]),
      },
    });
  });
});
