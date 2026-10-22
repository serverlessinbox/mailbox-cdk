/// <reference types="jest" />

/**
 * Pins the deployed shape of the stack-helpers Lambda: it runs the stack-helpers bundle and may call
 * Route 53 GetHostedZone and nothing else of Route 53. Without the grant every lookup fails at deploy
 * time with AccessDenied, which no synth-time check reports.
 */

import { Match, Template }                         from 'aws-cdk-lib/assertions';

import { createStackWithResolver }                 from '../../../__tests__/stack-helpers-helpers';
import { actionsOf, allPolicyStatements }          from '../../../cdk-test-support';
import { StackHelpersLambda }                      from '../stack-helpers-lambda';

describe('StackHelpersLambda', () => {
  const { stack, resolver } = createStackWithResolver();
  new StackHelpersLambda(stack, 'handler', { artifactResolver: resolver });
  const template = Template.fromStack(stack);

  it('loads its code from the stack-helpers bundle of mailbox-cdk-shared', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Code: { S3Key: Match.stringLikeRegexp('lambdas/stack-helpers\\.zip$') },
    });
  });

  it('may only get hosted zones, and may not list them', () => {
    const route53Statements = allPolicyStatements(template)
      .filter((statement) => actionsOf(statement).some((action) => action.startsWith('route53:')));

    expect(route53Statements).toEqual([
      { Effect: 'Allow', Action: 'route53:GetHostedZone', Resource: '*' },
    ]);
  });
});
