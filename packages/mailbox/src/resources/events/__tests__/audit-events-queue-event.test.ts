/// <reference types="jest" />

/**
 * AuditEventsQueueEvent: the mapping from the audit events queue to its consumer. Batch size, window and
 * partial-failure reporting decide how audit events are delivered and retried.
 */

import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }              from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { defaultCfnResource }                   from '../../../utils/cfn-resource';
import { AuditEventsQueue }                     from '../../queues/audit-events-queue';
import { AuditEventsQueueEvent }                from '../audit-events-queue-event';

describe('AuditEventsQueueEvent', () => {
  let stack: Stack;
  let queue: AuditEventsQueue;
  let targetId: string;
  let template: Template;

  beforeEach(() => {
    stack        = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    queue        = new AuditEventsQueue(stack, 'audit-events-queue');
    const target = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });

    new AuditEventsQueueEvent(target, 'audit-events-queue', { target, queue });

    targetId = stack.getLogicalId(defaultCfnResource(target));
    template = Template.fromStack(stack);
  });

  it('maps the queue to the target in batches of 100 with a 30 second window and partial failure reporting', () => {
    const queueArn: unknown = stack.resolve(queue.queueArn);

    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn:                 queueArn,
      FunctionName:                   { Ref: targetId },
      BatchSize:                      100,
      MaximumBatchingWindowInSeconds: 30,
      FunctionResponseTypes:          Match.arrayEquals(['ReportBatchItemFailures']),
    });
  });
});
