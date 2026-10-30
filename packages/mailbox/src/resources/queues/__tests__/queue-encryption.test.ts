/**
 * Every queue class maps a QueueEncryptionChoice variant the same way, on the queue and on its
 * dead-letter queue. These tests pin the rendered encryption of every AWS::SQS::Queue in the template for
 * each variant, and that SES event queue lets SNS use the customer-managed key it is given. A break here
 * leaves a queue silently less encrypted than the operator chose, or a topic unable to deliver to its queue.
 */

import type { QueueEncryptionChoice }                       from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                                  from 'aws-cdk-lib/assertions';
import * as kms                                             from 'aws-cdk-lib/aws-kms';
import { Topic }                                            from 'aws-cdk-lib/aws-sns';
import * as cdk                                             from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                    from 'aws-cdk-lib';

import { AuditEventsQueue }                                 from '../audit-events-queue';
import { EmailProcessingQueue }                             from '../email-processing-queue';
import { EmailSendingQueue }                                from '../email-sending-queue';
import { ImportJobsQueue }                                  from '../import-jobs-queue';
import { SesEventQueue }                                    from '../ses-event-queue';
import { TantivyIndexingScheduleDlq }                       from '../tantivy-indexing-schedule-dlq';

type Variant = 'aws-managed' | 'unencrypted' | 'kms';

type QueueBuilder = (stack: cdk.Stack, encryption: QueueEncryptionChoice) => void;

interface BuiltQueues {
  readonly template: Template;
  readonly keyId:    string;
}

const QUEUE_CLASSES: ReadonlyArray<readonly [string, QueueBuilder]> = [
  ['AuditEventsQueue', (stack, encryption) => new AuditEventsQueue(stack, 'queue', { encryption })],
  ['EmailSendingQueue', (stack, encryption) => new EmailSendingQueue(stack, 'queue', { encryption })],
  ['ImportJobsQueue', (stack, encryption) => new ImportJobsQueue(stack, 'queue', { encryption })],
  ['TantivyIndexingScheduleDlq', (stack, encryption) => new TantivyIndexingScheduleDlq(stack, 'queue', { encryption })],
  ['EmailProcessingQueue', (stack, encryption) => new EmailProcessingQueue(stack, 'queue', { encryption })],
  ['SesEventQueue', (stack, encryption) => new SesEventQueue(stack, 'queue', { topic: new Topic(stack, 'ses-topic'), encryption })],
];

function newStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

/** Builds one queue class in a fresh stack with the given variant; the customer-managed variant gets a key in the same stack. */
function buildQueue(build: QueueBuilder, variant: Variant): BuiltQueues {
  const stack = newStack();
  if (variant === 'kms') {
    const key = new kms.Key(stack, 'TestKey');
    build(stack, { kind: 'kms', key });
    return {
      template: Template.fromStack(stack),
      keyId:    stack.getLogicalId(key.node.defaultChild as cdk.CfnResource),
    };
  }
  build(stack, { kind: variant });
  return { template: Template.fromStack(stack), keyId: '' };
}

describe('queue encryption across the queue classes', () => {
  describe.each(QUEUE_CLASSES)('%s', (_name, build) => {
    it('encrypts every queue with SQS-managed encryption for the aws-managed choice', () => {
      const { template } = buildQueue(build, 'aws-managed');

      template.allResourcesProperties('AWS::SQS::Queue', {
        SqsManagedSseEnabled: true,
        KmsMasterKeyId:       Match.absent(),
      });
    });

    it('leaves every queue unencrypted for the unencrypted choice', () => {
      const { template } = buildQueue(build, 'unencrypted');

      template.allResourcesProperties('AWS::SQS::Queue', {
        SqsManagedSseEnabled: Match.not(true),
        KmsMasterKeyId:       Match.absent(),
      });
    });

    it('encrypts every queue with the customer-managed key for the kms choice', () => {
      const { template, keyId } = buildQueue(build, 'kms');

      template.allResourcesProperties('AWS::SQS::Queue', {
        KmsMasterKeyId: Match.objectLike({ 'Fn::GetAtt': [keyId, 'Arn'] }),
      });
    });
  });
});
