import { Match, Template }    from 'aws-cdk-lib/assertions';
import * as kms               from 'aws-cdk-lib/aws-kms';

import { defaultCfnResource } from '../../../utils/cfn-resource';
import { ImportJobsQueue }    from '../import-jobs-queue';

import { createStack }        from './queue-helpers';

/**
 * ImportJobsQueue tests.
 *
 * Pin what it adds to a base queue: the dead-letter queue beside it (3 receives, 14 day retention) and
 * that both queues take the encryption it is given. A regression moves a job to the dead-letter queue too
 * early or encrypts the two queues differently.
 */

describe('ImportJobsQueue', () => {
  it('moves a message to the 14 day dead-letter queue created beside it after 3 receives', () => {
    const stack = createStack();
    new ImportJobsQueue(stack, 'import-jobs-queue', { encryption: { kind: 'aws-managed' } });

    const template = Template.fromStack(stack);
    const dlqId    = stack.getLogicalId(defaultCfnResource(stack.node.findChild('import-jobs-queue-dlq')));

    template.hasResourceProperties('AWS::SQS::Queue', {
      RedrivePolicy: { deadLetterTargetArn: { 'Fn::GetAtt': [dlqId, 'Arn'] }, maxReceiveCount: 3 },
    });
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
    });
  });

  it('uses SQS-managed encryption on both queues for the aws-managed choice', () => {
    const stack = createStack();
    new ImportJobsQueue(stack, 'import-jobs-queue', { encryption: { kind: 'aws-managed' } });

    Template.fromStack(stack).resourcePropertiesCountIs('AWS::SQS::Queue', {
      SqsManagedSseEnabled: true,
    }, 2);
  });

  it('uses the given KMS master key on both queues for the kms choice', () => {
    const stack = createStack();
    const key   = new kms.Key(stack, 'TestKey');
    new ImportJobsQueue(stack, 'import-jobs-queue', { encryption: { kind: 'kms', key } });

    Template.fromStack(stack).allResourcesProperties('AWS::SQS::Queue', {
      KmsMasterKeyId: { 'Fn::GetAtt': [stack.getLogicalId(defaultCfnResource(key)), 'Arn'] },
    });
    Template.fromStack(stack).resourcePropertiesCountIs('AWS::SQS::Queue', {
      KmsMasterKeyId: Match.anyValue(),
    }, 2);
  });
});
