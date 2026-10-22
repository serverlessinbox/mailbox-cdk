import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }              from 'aws-cdk-lib/aws-lambda';
import { Queue }                                from 'aws-cdk-lib/aws-sqs';
/// <reference types="jest" />
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { SearchIndexingSchedule }               from '../search-indexing-schedule';

describe('SearchIndexingSchedule', () => {
  let template: Template;

  beforeEach(() => {
    const stack           = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    const target          = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });
    const deadLetterQueue = new Queue(stack, 'dlq');

    new SearchIndexingSchedule(target, 'indexing-schedule', { target, deadLetterQueue });

    template = Template.fromStack(stack);
  });

  it('invokes the target every 6 hours with the indexing description', () => {
    template.resourceCountIs('AWS::Events::Rule', 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(6 hours)',
      Description: 'Trigger Tantivy indexing every 6 hours',
      State: 'ENABLED',
      Targets: [Match.objectLike({ Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^target'), 'Arn'] } })],
    });
  });

  it('sends invocations EventBridge cannot deliver to the dead-letter queue', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: [Match.objectLike({ DeadLetterConfig: { Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^dlq'), 'Arn'] } } })],
    });
    template.hasResourceProperties('AWS::SQS::QueuePolicy', {
      PolicyDocument: { Statement: [Match.objectLike({ Action: 'sqs:SendMessage', Principal: { Service: 'events.amazonaws.com' } })] },
    });
  });
});
