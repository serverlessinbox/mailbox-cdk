import { Match, Template }               from 'aws-cdk-lib/assertions';
import * as iam                          from 'aws-cdk-lib/aws-iam';
import * as kms                          from 'aws-cdk-lib/aws-kms';
import * as sqs                          from 'aws-cdk-lib/aws-sqs';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { SqsActions, grantQueueActions } from '../sqs-grants';

function createStack(): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function createRole(stack: cdk.Stack): iam.Role {
  return new iam.Role(stack, 'TestRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  });
}

describe('grantQueueActions', () => {
  it('send on an unencrypted queue grants exactly sqs:SendMessage on the queue ARN, no KMS', () => {
    const stack = createStack();
    const queue = new sqs.Queue(stack, 'TestQueue');
    const role  = createRole(stack);

    grantQueueActions(role, queue, SqsActions.send);

    const template = Template.fromStack(stack);
    const queueId  = stack.getLogicalId(queue.node.defaultChild as cdk.CfnResource);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   'sqs:SendMessage',
            Effect:   'Allow',
            Resource: { 'Fn::GetAtt': [queueId, 'Arn'] },
          }),
        ]),
      },
    });
  });

  it('consume on the same queue grants exactly the consume actions, no KMS', () => {
    const stack = createStack();
    const queue = new sqs.Queue(stack, 'TestQueue');
    const role  = createRole(stack);

    grantQueueActions(role, queue, SqsActions.consume);

    const template = Template.fromStack(stack);
    const queueId  = stack.getLogicalId(queue.node.defaultChild as cdk.CfnResource);

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

  it('send on a customer-managed KMS key queue grants the SQS statement plus the exact send KMS statement', () => {
    const stack = createStack();
    const key   = new kms.Key(stack, 'TestKey');
    const queue = new sqs.Queue(stack, 'TestQueue', { encryptionMasterKey: key });
    const role  = createRole(stack);

    grantQueueActions(role, queue, SqsActions.send);

    const template = Template.fromStack(stack);
    const queueId  = stack.getLogicalId(queue.node.defaultChild as cdk.CfnResource);
    const keyId    = stack.getLogicalId(key.node.defaultChild as cdk.CfnResource);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   'sqs:SendMessage',
            Effect:   'Allow',
            Resource: { 'Fn::GetAtt': [queueId, 'Arn'] },
          }),
          Match.objectEquals({
            Action:   ['kms:GenerateDataKey*', 'kms:Decrypt'],
            Effect:   'Allow',
            Resource: { 'Fn::GetAtt': [keyId, 'Arn'] },
          }),
        ]),
      },
    });
  });

  it('consume on a customer-managed KMS key queue grants the SQS statement plus the exact consume KMS statement', () => {
    const stack = createStack();
    const key   = new kms.Key(stack, 'TestKey');
    const queue = new sqs.Queue(stack, 'TestQueue', { encryptionMasterKey: key });
    const role  = createRole(stack);

    grantQueueActions(role, queue, SqsActions.consume);

    const template = Template.fromStack(stack);
    const queueId  = stack.getLogicalId(queue.node.defaultChild as cdk.CfnResource);
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

describe('SqsActions', () => {
  it('contains no broader-than-necessary or wildcard actions', () => {
    const all = [...SqsActions.send, ...SqsActions.consume];
    for (const forbidden of ['sqs:GetQueueUrl', 'sqs:ChangeMessageVisibility', 'sqs:PurgeQueue', 'sqs:*', '*']) {
      expect(all).not.toContain(forbidden);
    }
  });
});
