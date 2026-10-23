/// <reference types="jest" />

/**
 * SearchIndexingSchedule: the rule that invokes search indexing every 6 hours. The dead-letter target is
 * what keeps an undeliverable indexing run from vanishing.
 */

import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }              from 'aws-cdk-lib/aws-lambda';
import { Queue }                                from 'aws-cdk-lib/aws-sqs';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { defaultCfnResource }                   from '../../../utils/cfn-resource';
import { SearchIndexingSchedule }               from '../search-indexing-schedule';

describe('SearchIndexingSchedule', () => {
  let dlqId:      string;
  let targetId:   string;
  let template:   Template;

  beforeEach(() => {
    const stack           = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    const target          = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });
    const deadLetterQueue = new Queue(stack, 'dlq');

    new SearchIndexingSchedule(target, 'indexing-schedule', { target, deadLetterQueue });

    targetId = stack.getLogicalId(defaultCfnResource(target));
    dlqId    = stack.getLogicalId(defaultCfnResource(deadLetterQueue));
    template = Template.fromStack(stack);
  });

  it('invokes the target every 6 hours with the indexing description', () => {
    template.resourceCountIs('AWS::Events::Rule', 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(6 hours)',
      Description:        'Trigger Tantivy indexing every 6 hours',
      State:              'ENABLED',
      Targets:            [Match.objectLike({ Arn: { 'Fn::GetAtt': [targetId, 'Arn'] } })],
    });
  });

  it('sends invocations EventBridge cannot deliver to the dead-letter queue', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: [Match.objectLike({ DeadLetterConfig: { Arn: { 'Fn::GetAtt': [dlqId, 'Arn'] } } })],
    });
  });
});
