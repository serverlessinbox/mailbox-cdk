import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SesEventQueue } from '../ses-event-queue';

function createStack(): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('SesEventQueue', () => {
  it('grantConsume grants exactly the consume actions on the queue ARN, no KMS', () => {
    const stack = createStack();
    const topic = new Topic(stack, 'TestTopic');
    const sut = new SesEventQueue(stack, 'ses-event-queue', { topic });
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

  it('grantConsume with a customer-managed KMS key also grants the exact kms:Decrypt statement', () => {
    const stack = createStack();
    const topic = new Topic(stack, 'TestTopic');
    const key = new kms.Key(stack, 'TestKey');
    const sut = new SesEventQueue(stack, 'ses-event-queue', {
      topic,
      queueProps: { encryptionMasterKey: key },
    });
    const role = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantConsume(role);

    const template = Template.fromStack(stack);
    const queueId = stack.getLogicalId(sut.queue.node.defaultChild as cdk.CfnResource);
    const keyId = stack.getLogicalId(key.node.defaultChild as cdk.CfnResource);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles: Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
            Effect: 'Allow',
            Resource: { 'Fn::GetAtt': [queueId, 'Arn'] },
          }),
          Match.objectEquals({
            Action: 'kms:Decrypt',
            Effect: 'Allow',
            Resource: { 'Fn::GetAtt': [keyId, 'Arn'] },
          }),
        ]),
      },
    });
  });
});
