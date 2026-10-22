/**
 * EmailSendingQueue pins the two grant surfaces (send-only for producers, consume for the single
 * consumer) and the visibility timeout. Widening a grant would hand producers consume access;
 * shortening the timeout would redeliver submissions that are still being processed.
 */
import { Match, Template }               from 'aws-cdk-lib/assertions';
import * as iam                          from 'aws-cdk-lib/aws-iam';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { EmailSendingQueue }             from '../email-sending-queue';

function createStack(): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('EmailSendingQueue', () => {
  it('grantSend grants exactly sqs:SendMessage on the queue ARN', () => {
    const stack = createStack();
    const sut   = new EmailSendingQueue(stack, 'email-sending-queue');
    const role  = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantSend(role);

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   'sqs:SendMessage',
            Effect:   'Allow',
            Resource: stack.resolve(sut.queueArn),
          }),
        ]),
      },
    });
  });

  it('grantConsume grants exactly the consume actions on the queue ARN', () => {
    const stack = createStack();
    const sut   = new EmailSendingQueue(stack, 'email-sending-queue');
    const role  = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantConsume(role);

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
            Effect:   'Allow',
            Resource: stack.resolve(sut.queueArn),
          }),
        ]),
      },
    });
  });

  it('sets the visibility timeout to 6 minutes on the main queue, not only its dead-letter queue', () => {
    const stack = createStack();
    new EmailSendingQueue(stack, 'email-sending-queue');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 360,
      RedrivePolicy:     Match.anyValue(),
    });
  });
});
