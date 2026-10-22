import { Match, Template }               from 'aws-cdk-lib/assertions';
import * as iam                          from 'aws-cdk-lib/aws-iam';
import * as kms                          from 'aws-cdk-lib/aws-kms';
import { Topic }                         from 'aws-cdk-lib/aws-sns';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { SesEventQueue }                 from '../ses-event-queue';

/**
 * SesEventQueue tests.
 *
 * Pin what lets SNS deliver SES notifications into the queue (unencrypted by default, the topic's
 * permission on a customer-managed key, raw message delivery) and the consume grant; SNS cannot
 * deliver to a queue under the AWS-managed SQS key, so a regression drops notifications silently.
 */

function createStack(): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('SesEventQueue', () => {
  it('is unencrypted, with a 6 minute visibility timeout, when no key is supplied', () => {
    const stack = createStack();
    new SesEventQueue(stack, 'ses-event-queue', { topic: new Topic(stack, 'TestTopic') });

    const queueProperties = Template.fromStack(stack).findResources('AWS::SQS::Queue');
    const [queue]         = Object.values(queueProperties);

    expect(queue.Properties.VisibilityTimeout).toBe(360);
    expect(queue.Properties.KmsMasterKeyId).toBeUndefined();
    expect(queue.Properties.SqsManagedSseEnabled).toBe(false);
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
              ArnEquals:    { 'aws:SourceArn': stack.resolve(topic.topicArn) },
            },
          }),
        ]),
      },
    });
  });

  it('grantConsume grants exactly the consume actions on the queue ARN, no KMS', () => {
    const stack = createStack();
    const topic = new Topic(stack, 'TestTopic');
    const sut   = new SesEventQueue(stack, 'ses-event-queue', { topic });
    const role  = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantConsume(role);

    const template = Template.fromStack(stack);
    const queueId  = stack.getLogicalId(sut.queue.node.defaultChild as cdk.CfnResource);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
            Effect:   'Allow',
            Resource: { 'Fn::GetAtt': [queueId, 'Arn'] },
          }),
        ]),
      },
    });
  });

  it('grantConsume with a customer-managed KMS key also grants the exact kms:Decrypt statement', () => {
    const stack = createStack();
    const topic = new Topic(stack, 'TestTopic');
    const key   = new kms.Key(stack, 'TestKey');
    const sut   = new SesEventQueue(stack, 'ses-event-queue', {
      topic,
      queueProps: { encryptionMasterKey: key },
    });
    const role  = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantConsume(role);

    const template = Template.fromStack(stack);
    const queueId  = stack.getLogicalId(sut.queue.node.defaultChild as cdk.CfnResource);
    const keyId    = stack.getLogicalId(key.node.defaultChild as cdk.CfnResource);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
            Effect:   'Allow',
            Resource: { 'Fn::GetAtt': [queueId, 'Arn'] },
          }),
          Match.objectEquals({
            Action:   'kms:Decrypt',
            Effect:   'Allow',
            Resource: { 'Fn::GetAtt': [keyId, 'Arn'] },
          }),
        ]),
      },
    });
  });
});
