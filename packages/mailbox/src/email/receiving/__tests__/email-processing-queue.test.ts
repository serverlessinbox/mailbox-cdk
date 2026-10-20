import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import { EmailProcessingQueue } from '../email-processing-queue';

/**
 * EmailProcessingQueue tests.
 *
 * Pin the queue and dead-letter queue settings and the two grant methods; a regression redelivers
 * messages mid-processing, drops failed messages early, or gives a sender consume access.
 */

function createStack(): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('EmailProcessingQueue', () => {
  it('grantSend grants exactly sqs:SendMessage on the queue ARN', () => {
    const stack = createStack();
    const sut = new EmailProcessingQueue(stack, 'email-processing-queue');
    const role = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantSend(role);

    const template = Template.fromStack(stack);
    const queueId = stack.getLogicalId(sut.queue.node.defaultChild as cdk.CfnResource);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles: Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action: 'sqs:SendMessage',
            Effect: 'Allow',
            Resource: { 'Fn::GetAtt': [queueId, 'Arn'] },
          }),
        ]),
      },
    });
  });

  it('grantConsume grants exactly the consume actions on the queue ARN', () => {
    const stack = createStack();
    const sut = new EmailProcessingQueue(stack, 'email-processing-queue');
    const role = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantConsume(role);

    const template = Template.fromStack(stack);
    const queueId = stack.getLogicalId(sut.queue.node.defaultChild as cdk.CfnResource);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles: Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
            Effect: 'Allow',
            Resource: { 'Fn::GetAtt': [queueId, 'Arn'] },
          }),
        ]),
      },
    });
  });

  it('queue visibility timeout is 6 minutes, so a message is not redelivered while its consumer works', () => {
    const stack = createStack();
    new EmailProcessingQueue(stack, 'email-processing-queue');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 360,
      RedrivePolicy: Match.anyValue(),
    });
  });

  it('moves a message to the 14 day dead-letter queue after 3 receives', () => {
    const stack = createStack();
    const sut = new EmailProcessingQueue(stack, 'email-processing-queue');

    const template = Template.fromStack(stack);
    const dlqId = stack.getLogicalId(sut.dlq.node.defaultChild as cdk.CfnResource);

    template.hasResourceProperties('AWS::SQS::Queue', {
      RedrivePolicy: { deadLetterTargetArn: { 'Fn::GetAtt': [dlqId, 'Arn'] }, maxReceiveCount: 3 },
    });
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
    });
  });

  it('uses SQS-managed encryption without a master key', () => {
    const stack = createStack();
    new EmailProcessingQueue(stack, 'email-processing-queue');

    Template.fromStack(stack).allResourcesProperties('AWS::SQS::Queue', {
      SqsManagedSseEnabled: true,
    });
  });

  it('uses the given KMS master key for both queues', () => {
    const stack = createStack();
    const key = new kms.Key(stack, 'TestKey');
    new EmailProcessingQueue(stack, 'email-processing-queue', { queueProps: { encryptionMasterKey: key } });

    Template.fromStack(stack).allResourcesProperties('AWS::SQS::Queue', {
      KmsMasterKeyId: { 'Fn::GetAtt': [stack.getLogicalId(key.node.defaultChild as cdk.CfnResource), 'Arn'] },
    });
  });
});
