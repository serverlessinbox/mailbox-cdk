import { Match, Template }    from 'aws-cdk-lib/assertions';
import * as kms               from 'aws-cdk-lib/aws-kms';
import { QueueEncryption }    from 'aws-cdk-lib/aws-sqs';

import { defaultCfnResource } from '../../../utils/cfn-resource';
import { ImportJobsQueue }    from '../import-jobs-queue';

import { createStack }        from './queue-helpers';

/**
 * ImportJobsQueue tests.
 *
 * Pin what it adds to a base queue: the dead-letter queue beside it (3 receives, 14 day retention) and
 * the encryption it takes from the queue defaults for both queues. A regression moves a job to the
 * dead-letter queue too early or encrypts the two queues differently.
 */

describe('ImportJobsQueue', () => {
  it('moves a message to the 14 day dead-letter queue created beside it after 3 receives', () => {
    const stack = createStack();
    new ImportJobsQueue(stack, 'import-jobs-queue');

    const template = Template.fromStack(stack);
    const dlqId    = stack.getLogicalId(defaultCfnResource(stack.node.findChild('import-jobs-queue-dlq')));

    template.hasResourceProperties('AWS::SQS::Queue', {
      RedrivePolicy: { deadLetterTargetArn: { 'Fn::GetAtt': [dlqId, 'Arn'] }, maxReceiveCount: 3 },
    });
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
    });
  });

  it('uses the AWS-managed SQS key on both queues when no queue props are given', () => {
    const stack = createStack();
    new ImportJobsQueue(stack, 'import-jobs-queue');

    Template.fromStack(stack).resourcePropertiesCountIs('AWS::SQS::Queue', {
      KmsMasterKeyId: 'alias/aws/sqs',
    }, 2);
  });

  it('uses the given KMS master key on both queues when the queue props carry one', () => {
    const stack = createStack();
    const key   = new kms.Key(stack, 'TestKey');
    new ImportJobsQueue(stack, 'import-jobs-queue', {
      queueProps: { encryption: QueueEncryption.KMS, encryptionMasterKey: key },
    });

    Template.fromStack(stack).allResourcesProperties('AWS::SQS::Queue', {
      KmsMasterKeyId: { 'Fn::GetAtt': [stack.getLogicalId(defaultCfnResource(key)), 'Arn'] },
    });
    Template.fromStack(stack).resourcePropertiesCountIs('AWS::SQS::Queue', {
      KmsMasterKeyId: Match.anyValue(),
    }, 2);
  });
});
