/**
 * BaseQueue default tests.
 *
 * Pins the defaults every Mailbox queue inherits (visibility timeout, long polling, encryption
 * choice, generated name); a regression changes queue behaviour for all queues that do not override
 * them, such as messages reappearing before a consumer finishes.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer, Duration } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import { BaseQueue } from '../base-queue';
import type { BaseQueueProps } from '../base-queue';

function queueTemplate(props?: BaseQueueProps, keyProps?: kms.KeyProps): Template {
  const stack = new cdk.Stack(new App(), 'TestStack', {
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

  it('generates a physical queue name when none is given and keeps an explicit one', () => {
    queueTemplate().hasResourceProperties('AWS::SQS::Queue', { QueueName: Match.anyValue() });
    queueTemplate({ queueName: 'explicit-name' }).hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'explicit-name',
    });
  });

  it('generates the same name when the caller passes queueName: undefined', () => {
    const generated = queueTemplate().findResources('AWS::SQS::Queue');
    const withUndefined = queueTemplate({ queueName: undefined }).findResources('AWS::SQS::Queue');

    const [{ Properties: generatedProperties }] = Object.values(generated);
    const [{ Properties: undefinedProperties }] = Object.values(withUndefined);

    expect(typeof generatedProperties.QueueName).toBe('string');
    expect(undefinedProperties.QueueName).toBe(generatedProperties.QueueName);
  });

  it('encrypts with the SQS-managed KMS key by default', () => {
    queueTemplate().hasResourceProperties('AWS::SQS::Queue', { KmsMasterKeyId: 'alias/aws/sqs' });
  });

  it('encrypts with the given KMS key when one is supplied', () => {
    queueTemplate({}, {}).hasResourceProperties('AWS::SQS::Queue', {
      KmsMasterKeyId: Match.objectLike({ 'Fn::GetAtt': [Match.stringLikeRegexp('^TestKey'), 'Arn'] }),
    });
  });
});
