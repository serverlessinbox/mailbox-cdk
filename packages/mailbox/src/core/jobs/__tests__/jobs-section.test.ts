import { Template }                              from 'aws-cdk-lib/assertions';
import * as kms                                  from 'aws-cdk-lib/aws-kms';
import { QueueEncryption }                       from 'aws-cdk-lib/aws-sqs';
import * as cdk                                  from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }         from 'aws-cdk-lib';

import { defaultCfnResource }                    from '../../../utils/cfn-resource';
import { JobsSection }                           from '../jobs-section';

/**
 * JobsSection tests.
 *
 * Pin that the section applies the queue encryption it receives to the import-jobs queue and its
 * dead-letter queue, so the mail-import queue follows the Mailbox encryption setting.
 */

function createStack(): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('JobsSection', () => {
  it('applies the queue encryption of the plan to the import-jobs queue and its dead-letter queue', () => {
    const stack = createStack();
    const key   = new kms.Key(stack, 'TestKey');
    new JobsSection(stack, 'jobs', {
      queueProps: { encryption: QueueEncryption.KMS, encryptionMasterKey: key },
    });

    Template.fromStack(stack).resourcePropertiesCountIs('AWS::SQS::Queue', {
      KmsMasterKeyId: { 'Fn::GetAtt': [stack.getLogicalId(defaultCfnResource(key)), 'Arn'] },
    }, 2);
  });

  it('exposes the queue through its narrow interface', () => {
    const stack   = createStack();
    const section = new JobsSection(stack, 'jobs', {});

    expect(section.importJobsQueue.queueArn).toBeDefined();
  });
});
