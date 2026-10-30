import { Match, Template }      from 'aws-cdk-lib/assertions';
import * as kms                 from 'aws-cdk-lib/aws-kms';

import { defaultCfnResource }   from '../../../utils/cfn-resource';
import { EmailProcessingQueue } from '../email-processing-queue';

import { createStack }          from './queue-helpers';

/**
 * EmailProcessingQueue tests.
 *
 * Pin what it adds to a base queue: the settings of the queue and of the dead-letter queue beside it, and the
 * encryption it is given for both queues. A regression redelivers messages mid-processing, drops failed messages
 * early, or encrypts one of the queues differently from the other.
 */

describe('EmailProcessingQueue', () => {
  it('queue visibility timeout is 6 minutes, so a message is not redelivered while its consumer works', () => {
    const stack = createStack();
    new EmailProcessingQueue(stack, 'email-processing-queue', { encryption: { kind: 'aws-managed' } });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 360,
      RedrivePolicy:     Match.anyValue(),
    });
  });

  it('moves a message to the 14 day dead-letter queue created beside it after 3 receives', () => {
    const stack = createStack();
    new EmailProcessingQueue(stack, 'email-processing-queue', { encryption: { kind: 'aws-managed' } });

    const template = Template.fromStack(stack);
    const dlqId    = stack.getLogicalId(defaultCfnResource(stack.node.findChild('email-processing-queue-dlq')));

    template.hasResourceProperties('AWS::SQS::Queue', {
      RedrivePolicy: { deadLetterTargetArn: { 'Fn::GetAtt': [dlqId, 'Arn'] }, maxReceiveCount: 3 },
    });
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
    });
  });

  it('uses SQS-managed encryption on both queues for the aws-managed choice', () => {
    const stack = createStack();
    new EmailProcessingQueue(stack, 'email-processing-queue', { encryption: { kind: 'aws-managed' } });

    Template.fromStack(stack).allResourcesProperties('AWS::SQS::Queue', {
      SqsManagedSseEnabled: true,
    });
  });

  it('leaves both queues unencrypted for the unencrypted choice, which is how SQS-excluded installs run', () => {
    const stack = createStack();
    new EmailProcessingQueue(stack, 'email-processing-queue', { encryption: { kind: 'unencrypted' } });

    Template.fromStack(stack).allResourcesProperties('AWS::SQS::Queue', {
      SqsManagedSseEnabled: Match.not(true),
      KmsMasterKeyId:       Match.absent(),
    });
  });

  it('uses the given KMS master key for both queues', () => {
    const stack = createStack();
    const key   = new kms.Key(stack, 'TestKey');
    new EmailProcessingQueue(stack, 'email-processing-queue', { encryption: { kind: 'kms', key } });

    Template.fromStack(stack).allResourcesProperties('AWS::SQS::Queue', {
      KmsMasterKeyId: { 'Fn::GetAtt': [stack.getLogicalId(defaultCfnResource(key)), 'Arn'] },
    });
  });
});
