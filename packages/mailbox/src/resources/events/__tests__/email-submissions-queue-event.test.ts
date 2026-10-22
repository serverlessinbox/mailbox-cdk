import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }              from 'aws-cdk-lib/aws-lambda';
/// <reference types="jest" />
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { EmailSendingQueue }                    from '../../queues/email-sending-queue';
import { EmailSubmissionsQueueEvent }           from '../email-submissions-queue-event';

describe('EmailSubmissionsQueueEvent', () => {
  let stack: Stack;
  let queue: EmailSendingQueue;
  let template: Template;

  beforeEach(() => {
    stack        = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    queue        = new EmailSendingQueue(stack, 'email-submissions-queue');
    const target = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });

    new EmailSubmissionsQueueEvent(target, 'email-submissions-queue', { target, queue });

    template = Template.fromStack(stack);
  });

  it('maps the queue to the target one message per batch with a 15 second window', () => {
    const queueArn: unknown = stack.resolve(queue.queueArn);

    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn:                 queueArn,
      FunctionName:                   Match.objectLike({ Ref: Match.stringLikeRegexp('^target') }),
      BatchSize:                      1,
      MaximumBatchingWindowInSeconds: 15,
    });
  });
});
