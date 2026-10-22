/// <reference types="jest" />

/**
 * SesNotificationsQueueEvent: the mapping from the SES event queue to its consumer. Batch size, window,
 * concurrency cap and partial-failure reporting decide how SES notifications are delivered and retried.
 */

import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }              from 'aws-cdk-lib/aws-lambda';
import { Topic }                                from 'aws-cdk-lib/aws-sns';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { SesEventQueue }                        from '../../queues/ses-event-queue';
import { SesNotificationsQueueEvent }           from '../ses-notifications-queue-event';

describe('SesNotificationsQueueEvent', () => {
  let stack: Stack;
  let queue: SesEventQueue;
  let template: Template;

  beforeEach(() => {
    stack        = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    queue        = new SesEventQueue(stack, 'ses-event-queue', { topic: new Topic(stack, 'topic') });
    const target = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });

    new SesNotificationsQueueEvent(target, 'ses-notifications-queue', { target, queue });

    template = Template.fromStack(stack);
  });

  it('maps the queue to the target in batches of 100, 5 concurrent batches, 30 second window, partial failure reporting', () => {
    const queueArn: unknown = stack.resolve(queue.queueArn);

    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn:                 queueArn,
      FunctionName:                   Match.objectLike({ Ref: Match.stringLikeRegexp('^target') }),
      BatchSize:                      100,
      MaximumBatchingWindowInSeconds: 30,
      ScalingConfig:                  Match.objectEquals({ MaximumConcurrency: 5 }),
      FunctionResponseTypes:          Match.arrayEquals(['ReportBatchItemFailures']),
    });
  });
});
