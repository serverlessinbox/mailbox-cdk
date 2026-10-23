/// <reference types="jest" />

/**
 * EmailSubmissionsQueueEvent: the mapping from the sending queue to its consumer. One message per batch
 * keeps each send independent of the others.
 */

import { Template }                             from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }              from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { defaultCfnResource }                   from '../../../utils/cfn-resource';
import { EmailSendingQueue }                    from '../../queues/email-sending-queue';
import { EmailSubmissionsQueueEvent }           from '../email-submissions-queue-event';

describe('EmailSubmissionsQueueEvent', () => {
  let stack: Stack;
  let queue: EmailSendingQueue;
  let targetId: string;
  let template: Template;

  beforeEach(() => {
    stack        = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    queue        = new EmailSendingQueue(stack, 'email-submissions-queue');
    const target = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });

    new EmailSubmissionsQueueEvent(target, 'email-submissions-queue', { target, queue });

    targetId = stack.getLogicalId(defaultCfnResource(target));
    template = Template.fromStack(stack);
  });

  it('maps the queue to the target one message per batch with a 15 second window', () => {
    const queueArn: unknown = stack.resolve(queue.queueArn);

    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn:                 queueArn,
      FunctionName:                   { Ref: targetId },
      BatchSize:                      1,
      MaximumBatchingWindowInSeconds: 15,
    });
  });
});
