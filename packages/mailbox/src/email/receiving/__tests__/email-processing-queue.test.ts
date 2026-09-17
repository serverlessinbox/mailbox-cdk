import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EmailProcessingQueue } from '../email-processing-queue';

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
});
