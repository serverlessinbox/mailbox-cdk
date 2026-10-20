/**
 * BaseQueue default tests.
 *
 * Pins the defaults every Mailbox queue inherits (visibility timeout, long polling, encryption
 * choice, generated name); a regression changes queue behaviour for all queues that do not override
 * them, such as messages reappearing before a consumer finishes.
 */

import { Match, Template }                         from 'aws-cdk-lib/assertions';
import * as kms                                    from 'aws-cdk-lib/aws-kms';
import * as cdk                                    from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer, Duration } from 'aws-cdk-lib';
import { Construct }                               from 'constructs';

import { BaseQueue }                               from '../base-queue';
import type { BaseQueueProps }                     from '../base-queue';
import { PositionHash }                            from '../naming/position-hash';
import { StackIdentity }                           from '../naming/stack-identity';

function queueTemplate(props?: BaseQueueProps, keyProps?: kms.KeyProps): Template {
  const stack               = new cdk.Stack(new App(), 'TestStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const encryptionMasterKey = keyProps ? new kms.Key(stack, 'TestKey', keyProps) : undefined;
  new BaseQueue(stack, 'jobs', { ...props, ...(encryptionMasterKey ? { encryptionMasterKey } : {}) });
  return Template.fromStack(stack);
}

describe('BaseQueue', () => {
  it('defaults to a 6 minute visibility timeout and 20 second long polling', () => {
    queueTemplate().hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 360,
      ReceiveMessageWaitTimeSeconds: 20,
    });
  });

  it('uses the given visibility timeout and wait time instead of the defaults', () => {
    queueTemplate({
      visibilityTimeout: Duration.minutes(2),
      receiveMessageWaitTime: Duration.seconds(5),
    }).hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 120,
      ReceiveMessageWaitTimeSeconds: 5,
    });
  });

  it('names the queue after its own position in the tree and the install', () => {
    const stack = new cdk.Stack(new App(), 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const group = new Construct(stack, 'group');
    new BaseQueue(group, 'jobs');

    Template.fromStack(stack).hasResourceProperties('AWS::SQS::Queue', {
      QueueName: {
        'Fn::Join': ['', [`123456789012-teststack-jobs-${PositionHash.ofChild(group, 'jobs')}-`, stack.resolve(StackIdentity.guidPrefix)]],
      },
    });
  });

  it('keeps an explicit queue name', () => {
    queueTemplate({ queueName: 'explicit-name' }).hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'explicit-name',
    });
  });

  it('generates the same name when the caller passes queueName: undefined', () => {
    const generated     = queueTemplate().findResources('AWS::SQS::Queue');
    const withUndefined = queueTemplate({ queueName: undefined }).findResources('AWS::SQS::Queue');

    const [{ Properties: generatedProperties }] = Object.values(generated);
    const [{ Properties: undefinedProperties }] = Object.values(withUndefined);

    expect(generatedProperties.QueueName).toBeDefined();
    expect(undefinedProperties.QueueName).toEqual(generatedProperties.QueueName);
  });

  it('encrypts with the SQS-managed KMS key by default', () => {
    queueTemplate().hasResourceProperties('AWS::SQS::Queue', { KmsMasterKeyId: 'alias/aws/sqs' });
  });

  it('encrypts with the SQS-managed KMS key when the caller passes encryption: undefined', () => {
    queueTemplate({ encryption: undefined }).hasResourceProperties('AWS::SQS::Queue', { KmsMasterKeyId: 'alias/aws/sqs' });
  });

  it('encrypts with the given KMS key when one is supplied', () => {
    queueTemplate({}, {}).hasResourceProperties('AWS::SQS::Queue', {
      KmsMasterKeyId: Match.objectLike({ 'Fn::GetAtt': [Match.stringLikeRegexp('^TestKey'), 'Arn'] }),
    });
  });
});
