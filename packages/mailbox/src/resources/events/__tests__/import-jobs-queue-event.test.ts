/// <reference types="jest" />

/**
 * ImportJobsQueueEvent tests: the mapping that feeds the import-jobs queue to the runner. One job per batch, at most
 * two concurrent invocations and partial batch reporting, read from the synthesized mapping.
 */

import { Template }                                                 from 'aws-cdk-lib/assertions';
import { Code, Function as LambdaFunction, Runtime }                from 'aws-cdk-lib/aws-lambda';
import * as cdk                                                     from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                            from 'aws-cdk-lib';

import { ImportJobsQueue }                                          from '../../queues/import-jobs-queue';
import { ImportJobsQueueEvent }                                     from '../import-jobs-queue-event';

function arrangeEvent() {
  const stack  = new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const queue  = new ImportJobsQueue(stack, 'import-jobs-queue');
  const target = new LambdaFunction(stack, 'runner', {
    runtime: Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code:    Code.fromInline('exports.handler = async () => undefined;'),
  });
  new ImportJobsQueueEvent(stack, 'import-jobs-queue-event', { target, queue });

  return { stack, template: Template.fromStack(stack), queue, target };
}

describe('ImportJobsQueueEvent', () => {
  it('feeds one import job per batch', () => {
    const { template } = arrangeEvent();

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', { BatchSize: 1 });
  });

  it('allows at most two concurrent invocations of the runner', () => {
    const { template } = arrangeEvent();

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', { ScalingConfig: { MaximumConcurrency: 2 } });
  });

  it('reports failed records by message, so a batch is not retried as a whole', () => {
    const { template } = arrangeEvent();

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', { FunctionResponseTypes: ['ReportBatchItemFailures'] });
  });

  it('reads from the import-jobs queue and invokes the target', () => {
    const { stack, template, queue, target } = arrangeEvent();
    const queueArn: unknown                  = stack.resolve(queue.queueArn);
    const functionName: unknown              = stack.resolve(target.functionName);

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: queueArn,
      FunctionName:   functionName,
    });
  });
});
