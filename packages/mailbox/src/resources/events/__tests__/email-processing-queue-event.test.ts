/// <reference types="jest" />

/**
 * EmailProcessingQueueEvent: the mapping from the inbound email queue to its consumer. Batch size, window
 * and partial-failure reporting decide how inbound emails are delivered and retried.
 */

import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }              from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { defaultCfnResource }                   from '../../../utils/cfn-resource';
import { EmailProcessingQueue }                 from '../../queues/email-processing-queue';
import { EmailProcessingQueueEvent }            from '../email-processing-queue-event';

describe('EmailProcessingQueueEvent', () => {
  let stack: Stack;
  let queue: EmailProcessingQueue;
  let targetId: string;
  let template: Template;

  beforeEach(() => {
    stack        = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    queue        = new EmailProcessingQueue(stack, 'email-processing-queue');
    const target = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });

    new EmailProcessingQueueEvent(target, 'email-processing-queue', { target, queue });

    targetId = stack.getLogicalId(defaultCfnResource(target));
    template = Template.fromStack(stack);
  });

  it('maps the queue to the target in batches of 10 with a 15 second window and partial failure reporting', () => {
    const queueArn: unknown = stack.resolve(queue.queueArn);

    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn:                 queueArn,
      FunctionName:                   { Ref: targetId },
      BatchSize:                      10,
      MaximumBatchingWindowInSeconds: 15,
      FunctionResponseTypes:          Match.arrayEquals(['ReportBatchItemFailures']),
    });
  });
});
