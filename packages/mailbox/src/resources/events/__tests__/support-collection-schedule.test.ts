/// <reference types="jest" />

/**
 * SupportCollectionSchedule: the rule that invokes the support collector hourly. The cron expression sets
 * how often role assumptions are collected and their expiry enforced.
 */

import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }              from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { SupportCollectionSchedule }            from '../support-collection-schedule';

describe('SupportCollectionSchedule', () => {
  let template: Template;

  beforeEach(() => {
    const stack  = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    const target = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });

    new SupportCollectionSchedule(target, 'collection-schedule', { target });

    template = Template.fromStack(stack);
  });

  it('invokes the target hourly at minute 0 with the collector description', () => {
    template.resourceCountIs('AWS::Events::Rule', 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'cron(0 * * * ? *)',
      Description:        'Hourly trigger for support role assumption collector and expiry enforcement',
      State:              'ENABLED',
      Targets:            [Match.objectLike({ Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^target'), 'Arn'] } })],
    });
  });
});
