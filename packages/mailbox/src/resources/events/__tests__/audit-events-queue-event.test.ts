import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }              from 'aws-cdk-lib/aws-lambda';
/// <reference types="jest" />
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { AuditEventsQueue }                     from '../../queues/audit-events-queue';
import { AuditEventsQueueEvent }                from '../audit-events-queue-event';

describe('AuditEventsQueueEvent', () => {
  let stack: Stack;
  let queue: AuditEventsQueue;
  let template: Template;

  beforeEach(() => {
    stack        = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    queue        = new AuditEventsQueue(stack, 'audit-events-queue');
    const target = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });

    new AuditEventsQueueEvent(target, 'audit-events-queue', { target, queue });

    template = Template.fromStack(stack);
  });

  it('maps the queue to the target in batches of 100 with a 30 second window and partial failure reporting', () => {
    const queueArn: unknown = stack.resolve(queue.queueArn);

    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn:                 queueArn,
      FunctionName:                   Match.objectLike({ Ref: Match.stringLikeRegexp('^target') }),
      BatchSize:                      100,
      MaximumBatchingWindowInSeconds: 30,
      FunctionResponseTypes:          Match.arrayEquals(['ReportBatchItemFailures']),
    });
  });
});
