/// <reference types="jest" />

/**
 * Pins the deployed shape of the stack-helpers Lambda: it runs the stack-helpers bundle, it gets
 * `route53:GetHostedZone` only on the one zone a resolver call names, and it may read the status of its
 * parent stack (`cloudformation:DescribeStacks` on the stack id). Without the grants a zone lookup or a
 * status read fails at deploy time with AccessDenied, which no synth-time check reports.
 */

import { Match, Template }                         from 'aws-cdk-lib/assertions';

import { createStackWithResolver }                 from '../../../__tests__/stack-helpers-helpers';
import { actionsOf, allPolicyStatements }          from '../../../cdk-test-support';
import { StackHelpersLambda }                      from '../stack-helpers-lambda';

describe('StackHelpersLambda', () => {
  const { stack, resolver } = createStackWithResolver();
  new StackHelpersLambda(stack, 'handler', { artifactResolver: resolver });
  const template            = Template.fromStack(stack);

  it('loads its code from the stack-helpers bundle of mailbox-cdk-shared', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Code: { S3Key: Match.stringLikeRegexp('lambdas/stack-helpers\\.zip$') },
    });
  });

  it('grants no route53 statement while no zone is named', () => {
    const route53Statements = allPolicyStatements(template)
      .filter((statement) => actionsOf(statement).some((action) => action.startsWith('route53:')));

    expect(route53Statements).toEqual([]);
  });

  it('grants route53:GetHostedZone on the named zone\'s ARN and nothing else', () => {
    const { stack: zoneStack, resolver: zoneResolver } = createStackWithResolver();
    new StackHelpersLambda(zoneStack, 'handler', { artifactResolver: zoneResolver }).grantHostedZoneRead('Z123');

    const route53Statements = allPolicyStatements(Template.fromStack(zoneStack))
      .filter((statement) => actionsOf(statement).some((action) => action.startsWith('route53:')));

    expect(route53Statements).toEqual([
      {
        Effect:   'Allow',
        Action:   'route53:GetHostedZone',
        Resource: { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':route53:::hostedzone/Z123']] },
      },
    ]);
  });

  it('grants cloudformation:DescribeStacks on the stack id and nothing else', () => {
    const statusStatements = allPolicyStatements(template)
      .filter((statement) => actionsOf(statement).some((action) => action.startsWith('cloudformation:')));

    expect(statusStatements).toEqual([
      { Effect: 'Allow', Action: 'cloudformation:DescribeStacks', Resource: { Ref: 'AWS::StackId' } },
    ]);
  });
});
