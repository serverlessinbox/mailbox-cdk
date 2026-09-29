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

  it('queue visibility timeout is 6 minutes to exceed function timeout (1m) plus batching window (15s)', () => {
    const stack = createStack();
    new EmailProcessingQueue(stack, 'email-processing-queue');

    const template = Template.fromStack(stack);

    // Visibility timeout must be 6 minutes (360 seconds) to safely exceed the email-processor Lambda's
    // 1-minute timeout plus 15-second batching window, preventing message duplication.
    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 360,
    });
  });
});
