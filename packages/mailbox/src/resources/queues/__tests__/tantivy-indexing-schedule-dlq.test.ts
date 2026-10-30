/**
 * TantivyIndexingScheduleDlq tests.
 *
 * Pin the 14 day retention of failed scheduled invocations and that the encryption the caller gives reaches
 * the queue; a regression loses failed invocation records early.
 */

import { Template }                   from 'aws-cdk-lib/assertions';

import { TantivyIndexingScheduleDlq } from '../tantivy-indexing-schedule-dlq';

import { createStack }                from './queue-helpers';

describe('TantivyIndexingScheduleDlq', () => {
  it('retains messages for 14 days', () => {
    const stack = createStack();
    new TantivyIndexingScheduleDlq(stack, 'dlq', { encryption: { kind: 'aws-managed' } });

    Template.fromStack(stack).hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
    });
  });

  it('applies the encryption it is given to the queue', () => {
    const stack = createStack();
    new TantivyIndexingScheduleDlq(stack, 'dlq', { encryption: { kind: 'unencrypted' } });

    Template.fromStack(stack).hasResourceProperties('AWS::SQS::Queue', {
      SqsManagedSseEnabled:   false,
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
    });
  });
});
