import { Match, Template }    from 'aws-cdk-lib/assertions';
import * as kms               from 'aws-cdk-lib/aws-kms';
import { Topic }              from 'aws-cdk-lib/aws-sns';

import { SesEventQueue }      from '../ses-event-queue';

import { createStack }        from './queue-helpers';

/**
 * SesEventQueue tests.
 *
 * Pin what lets SNS deliver SES notifications into the queue (unencrypted by default, the topic's
 * permission on a customer-managed key, raw message delivery); SNS cannot deliver to a queue under the
 * AWS-managed SQS key, so a regression drops notifications silently.
 */

describe('SesEventQueue', () => {
  it('is unencrypted, with a 6 minute visibility timeout, when no key is supplied', () => {
    const stack = createStack();
    new SesEventQueue(stack, 'ses-event-queue', { topic: new Topic(stack, 'TestTopic') });

    Template.fromStack(stack).hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout:    360,
      KmsMasterKeyId:       Match.absent(),
      SqsManagedSseEnabled: false,
    });
  });

  it('subscribes the queue to the topic with raw message delivery', () => {
    const stack = createStack();
    new SesEventQueue(stack, 'ses-event-queue', { topic: new Topic(stack, 'TestTopic') });

    Template.fromStack(stack).hasResourceProperties('AWS::SNS::Subscription', {
      Protocol:           'sqs',
      RawMessageDelivery: true,
    });
  });

  it('lets the topic use a customer-managed key, scoped to the account (as a ref, not a literal) and the topic', () => {
    const stack = createStack();
    const topic = new Topic(stack, 'TestTopic');
    const key   = new kms.Key(stack, 'TestKey');
    new SesEventQueue(stack, 'ses-event-queue', { topic, queueProps: { encryptionMasterKey: key } });

    const topicArn: unknown = stack.resolve(topic.topicArn);

    Template.fromStack(stack).hasResourceProperties('AWS::KMS::Key', {
      KeyPolicy: {
        Statement: Match.arrayWith([
          Match.objectEquals({
            Action:    ['kms:Decrypt', 'kms:Encrypt', 'kms:ReEncrypt*', 'kms:GenerateDataKey*', 'kms:DescribeKey'],
            Effect:    'Allow',
            Principal: { Service: 'sns.amazonaws.com' },
            Resource:  '*',
            Condition: {
              StringEquals: { 'aws:SourceAccount': { Ref: 'AWS::AccountId' } },
              ArnEquals:    { 'aws:SourceArn': topicArn },
            },
          }),
        ]),
      },
    });
  });
});
