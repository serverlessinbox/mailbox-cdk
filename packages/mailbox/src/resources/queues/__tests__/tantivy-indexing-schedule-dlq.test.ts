/**
 * TantivyIndexingScheduleDlq tests.
 *
 * Pin the 14 day retention of failed scheduled invocations, that the caller's queue props reach the
 * queue, and that `queueArn` identifies the queue; a regression loses failed invocation records
 * early or hands the schedule a wrong target ARN.
 */

import { Template }                                from 'aws-cdk-lib/assertions';
import * as cdk                                    from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer, Duration } from 'aws-cdk-lib';

import { TantivyIndexingScheduleDlq }              from '../tantivy-indexing-schedule-dlq';

function createStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('TantivyIndexingScheduleDlq', () => {
  it('retains messages for 14 days', () => {
    const stack = createStack();
    new TantivyIndexingScheduleDlq(stack, 'dlq');

    Template.fromStack(stack).hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
    });
  });

  it('applies the given queue props, except that retention stays 14 days', () => {
    const stack = createStack();
    new TantivyIndexingScheduleDlq(stack, 'dlq', {
      queueProps: { visibilityTimeout: Duration.minutes(2), retentionPeriod: Duration.days(1) },
    });

    Template.fromStack(stack).hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout:      120,
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
    });
  });

  it('queueArn resolves to the queue resource\'s Arn attribute', () => {
    const stack = createStack();
    const sut   = new TantivyIndexingScheduleDlq(stack, 'dlq');

    const queueId = stack.getLogicalId(sut.queue.node.defaultChild as cdk.CfnResource);

    expect(stack.resolve(sut.queueArn)).toEqual({ 'Fn::GetAtt': [queueId, 'Arn'] });
  });
});
