/**
 * AuditEventsQueue pins the two grant surfaces: send-only for every Lambda that emits audit events,
 * consume for the single writer. Widening the send grant would let an emitter read or delete other
 * emitters' audit events.
 */
import { Match, Template }               from 'aws-cdk-lib/assertions';
import * as iam                          from 'aws-cdk-lib/aws-iam';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { AuditEventsQueue }              from '../audit-events-queue';

function createStack(): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('AuditEventsQueue', () => {
  it('grantSend grants exactly sqs:SendMessage on the queue ARN', () => {
    const stack = createStack();
    const sut   = new AuditEventsQueue(stack, 'audit-events-queue');
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

  it('sets the visibility timeout to 5 minutes on the main queue, not only its dead-letter queue', () => {
    const stack = createStack();
    new AuditEventsQueue(stack, 'audit-events-queue');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 300,
      RedrivePolicy:     Match.anyValue(),
    });
  });

  it('grantConsume grants exactly the consume actions on the queue ARN', () => {
    const stack = createStack();
    const sut   = new AuditEventsQueue(stack, 'audit-events-queue');
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
});
