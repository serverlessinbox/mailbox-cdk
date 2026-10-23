/**
 * TantivyIndexingScheduleDlq tests.
 *
 * Pin the 14 day retention of failed scheduled invocations and that the caller's queue props reach the
 * queue; a regression loses failed invocation records early.
 */

import { Template }                   from 'aws-cdk-lib/assertions';
import { Duration }                   from 'aws-cdk-lib';

import { TantivyIndexingScheduleDlq } from '../tantivy-indexing-schedule-dlq';

import { createStack }                from './queue-helpers';

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
});
