/**
 * BaseQueue tests.
 *
 * Pins the defaults every Mailbox queue inherits (visibility timeout, long polling, generated name), the
 * encryption each QueueEncryptionChoice variant produces, and the grants; a regression changes queue
 * behaviour for every queue, such as messages reappearing before a consumer finishes.
 */

import { Match, Template }                         from 'aws-cdk-lib/assertions';
import * as iam                                    from 'aws-cdk-lib/aws-iam';
import * as kms                                    from 'aws-cdk-lib/aws-kms';
import * as cdk                                    from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer, Duration } from 'aws-cdk-lib';
import { Construct }                               from 'constructs';

import { PositionHash }                            from '../../../naming/position-hash';
import { StackIdentity }                           from '../../../naming/stack-identity';
import { BaseQueue }                               from '../base-queue';
import type { BaseQueueProps }                     from '../base-queue';
import type { QueueEncryptionChoice }              from '../queue-encryption';

interface GrantedQueue {
  readonly template: Template;
  readonly queueId:  string;
  readonly keyId:    string;
}

const AWS_MANAGED: QueueEncryptionChoice = { kind: 'aws-managed' };
const UNENCRYPTED: QueueEncryptionChoice = { kind: 'unencrypted' };

function newStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

/** A role given the `grant` of a queue that is encrypted with a customer-managed key when `withKey` is set. */
function grantOnQueue(grant: 'grantSend' | 'grantConsume', withKey: boolean): GrantedQueue {
  const stack = newStack();
  const key   = new kms.Key(stack, 'TestKey');
  const queue = new BaseQueue(stack, 'jobs', {
    encryption: withKey ? { kind: 'kms', key } : AWS_MANAGED,
  });
  const role = new iam.Role(stack, 'TestRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });

  queue[grant](role);

  return {
    template: Template.fromStack(stack),
    queueId:  stack.getLogicalId(queue.node.defaultChild as cdk.CfnResource),
    keyId:    stack.getLogicalId(key.node.defaultChild as cdk.CfnResource),
  };
}

function queueTemplate(encryption: QueueEncryptionChoice, props: Omit<BaseQueueProps, 'encryption'> = {}): Template {
  const stack = newStack();
  new BaseQueue(stack, 'jobs', { ...props, encryption });
  return Template.fromStack(stack);
}

function kmsQueueTemplate(): Template {
  const stack = newStack();
  const key   = new kms.Key(stack, 'TestKey');
  new BaseQueue(stack, 'jobs', { encryption: { kind: 'kms', key } });
  return Template.fromStack(stack);
}

describe('BaseQueue', () => {
  it('defaults to a 6 minute visibility timeout and 20 second long polling', () => {
    queueTemplate(AWS_MANAGED).hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout:             360,
      ReceiveMessageWaitTimeSeconds: 20,
    });
  });

  it('uses the given visibility timeout and wait time instead of the defaults', () => {
    queueTemplate(AWS_MANAGED, {
      visibilityTimeout:      Duration.minutes(2),
      receiveMessageWaitTime: Duration.seconds(5),
    }).hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout:             120,
      ReceiveMessageWaitTimeSeconds: 5,
    });
  });

  it('names the queue after its own position in the tree and the install', () => {
    const stack = newStack();
    const group = new Construct(stack, 'group');
    new BaseQueue(group, 'jobs', { encryption: AWS_MANAGED });

    Template.fromStack(stack).hasResourceProperties('AWS::SQS::Queue', {
      QueueName: {
        'Fn::Join': ['', [{ Ref: 'AWS::StackName' }, `-jobs-${PositionHash.ofChild(group, 'jobs')}-`, stack.resolve(StackIdentity.guidPrefix)]],
      },
    });
  });

  it('keeps an explicit queue name', () => {
    queueTemplate(AWS_MANAGED, { queueName: 'explicit-name' }).hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'explicit-name',
    });
  });

  it('generates the same name when the caller passes queueName: undefined', () => {
    const generated     = queueTemplate(AWS_MANAGED).toJSON();
    const withUndefined = queueTemplate(AWS_MANAGED, { queueName: undefined }).toJSON();

    expect(JSON.stringify(generated)).toContain('QueueName');
    expect(withUndefined).toEqual(generated);
  });

  it('encrypts with SQS-managed encryption for the aws-managed choice', () => {
    queueTemplate(AWS_MANAGED).hasResourceProperties('AWS::SQS::Queue', { SqsManagedSseEnabled: true });
  });

  it('leaves the queue unencrypted for the unencrypted choice', () => {
    const queue = queueTemplate(UNENCRYPTED).findResources('AWS::SQS::Queue');

    for (const resource of Object.values(queue)) {
      expect(resource.Properties).not.toHaveProperty('KmsMasterKeyId');
      expect(resource.Properties).not.toHaveProperty('SqsManagedSseEnabled', true);
    }
  });

  it('encrypts with the given KMS key for the kms choice', () => {
    kmsQueueTemplate().hasResourceProperties('AWS::SQS::Queue', {
      KmsMasterKeyId: Match.objectLike({ 'Fn::GetAtt': [Match.stringLikeRegexp('^TestKey'), 'Arn'] }),
    });
  });

  it('denies every SQS action on requests that are not sent over TLS', () => {
    const template  = queueTemplate(AWS_MANAGED);
    const [queueId] = Object.keys(template.findResources('AWS::SQS::Queue'));

    template.hasResourceProperties('AWS::SQS::QueuePolicy', {
      PolicyDocument: {
        Statement: [
          {
            Action:    'sqs:*',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            Effect:    'Deny',
            Principal: { AWS: '*' },
            Resource:  { 'Fn::GetAtt': [queueId, 'Arn'] },
          },
        ],
      },
      Queues:         [{ Ref: queueId }],
    });
  });

  describe('grants', () => {
    it('grantSend grants exactly sqs:SendMessage on the queue ARN, with no KMS statement on a queue without a key', () => {
      const { template, queueId } = grantOnQueue('grantSend', false);

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayEquals([
            Match.objectEquals({ Action: 'sqs:SendMessage', Effect: 'Allow', Resource: { 'Fn::GetAtt': [queueId, 'Arn'] } }),
          ]),
        },
      });
    });

    it('grantConsume grants exactly the consume actions on the queue ARN, with no KMS statement on a queue without a key', () => {
      const { template, queueId } = grantOnQueue('grantConsume', false);

      template.hasResourceProperties('AWS::IAM::Policy', {
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

    it('adds the send KMS statement to grantSend on a queue with a customer-managed key', () => {
      const { template, queueId, keyId } = grantOnQueue('grantSend', true);

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayEquals([
            Match.objectEquals({ Action: 'sqs:SendMessage', Effect: 'Allow', Resource: { 'Fn::GetAtt': [queueId, 'Arn'] } }),
            Match.objectEquals({ Action: ['kms:GenerateDataKey*', 'kms:Decrypt'], Effect: 'Allow', Resource: { 'Fn::GetAtt': [keyId, 'Arn'] } }),
          ]),
        },
      });
    });

    it('adds the consume KMS statement to grantConsume on a queue with a customer-managed key', () => {
      const { template, queueId, keyId } = grantOnQueue('grantConsume', true);

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayEquals([
            Match.objectEquals({
              Action:   ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
              Effect:   'Allow',
              Resource: { 'Fn::GetAtt': [queueId, 'Arn'] },
            }),
            Match.objectEquals({ Action: 'kms:Decrypt', Effect: 'Allow', Resource: { 'Fn::GetAtt': [keyId, 'Arn'] } }),
          ]),
        },
      });
    });
  });
});
