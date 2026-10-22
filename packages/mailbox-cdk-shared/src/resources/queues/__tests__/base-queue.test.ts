/**
 * BaseQueue default tests.
 *
 * Pins the defaults every Mailbox queue inherits (visibility timeout, long polling, encryption
 * choice, generated name); a regression changes queue behaviour for all queues that do not override
 * them, such as messages reappearing before a consumer finishes.
 */

import { Match, Template }                         from 'aws-cdk-lib/assertions';
import * as iam                                    from 'aws-cdk-lib/aws-iam';
import * as kms                                    from 'aws-cdk-lib/aws-kms';
import * as cdk                                    from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer, Duration } from 'aws-cdk-lib';
import { Construct }                               from 'constructs';

import { SqsActions }                              from '../../../grants/sqs-actions';
import type { SqsAction }                          from '../../../grants/sqs-actions';
import { PositionHash }                            from '../../../naming/position-hash';
import { StackIdentity }                           from '../../../naming/stack-identity';
import { BaseQueue }                               from '../base-queue';
import type { BaseQueueProps }                     from '../base-queue';

interface GrantedQueue {
  readonly template: Template;
  readonly queueId:  string;
  readonly keyId:    string;
}

/** A role granted `actions` on a queue that is encrypted with a customer-managed key when `withKey` is set. */
function grantOnQueue(actions: readonly SqsAction[], withKey: boolean): GrantedQueue {
  const stack = new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const key   = new kms.Key(stack, 'TestKey');
  const queue = new BaseQueue(stack, 'jobs', withKey ? { encryptionMasterKey: key } : {});
  const role  = new iam.Role(stack, 'TestRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });

  queue.grantActions(role, actions);

  return {
    template: Template.fromStack(stack),
    queueId:  stack.getLogicalId(queue.node.defaultChild as cdk.CfnResource),
    keyId:    stack.getLogicalId(key.node.defaultChild as cdk.CfnResource),
  };
}

function queueTemplate(props?: BaseQueueProps, keyProps?: kms.KeyProps): Template {
  const stack               = new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const encryptionMasterKey = keyProps ? new kms.Key(stack, 'TestKey', keyProps) : undefined;
  new BaseQueue(stack, 'jobs', { ...props, ...(encryptionMasterKey ? { encryptionMasterKey } : {}) });
  return Template.fromStack(stack);
}

describe('BaseQueue', () => {
  it('defaults to a 6 minute visibility timeout and 20 second long polling', () => {
    queueTemplate().hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout:             360,
      ReceiveMessageWaitTimeSeconds: 20,
    });
  });

  it('uses the given visibility timeout and wait time instead of the defaults', () => {
    queueTemplate({
      visibilityTimeout:      Duration.minutes(2),
      receiveMessageWaitTime: Duration.seconds(5),
    }).hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout:             120,
      ReceiveMessageWaitTimeSeconds: 5,
    });
  });

  it('names the queue after its own position in the tree and the install', () => {
    const stack = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const group = new Construct(stack, 'group');
    new BaseQueue(group, 'jobs');

    Template.fromStack(stack).hasResourceProperties('AWS::SQS::Queue', {
      QueueName: {
        'Fn::Join': ['', [`123456789012-teststack-jobs-${PositionHash.ofChild(group, 'jobs')}-`, stack.resolve(StackIdentity.guidPrefix)]],
      },
    });
  });

  it('keeps an explicit queue name', () => {
    queueTemplate({ queueName: 'explicit-name' }).hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'explicit-name',
    });
  });

  it('generates the same name when the caller passes queueName: undefined', () => {
    const generated     = queueTemplate().toJSON();
    const withUndefined = queueTemplate({ queueName: undefined }).toJSON();

    expect(JSON.stringify(generated)).toContain('QueueName');
    expect(withUndefined).toEqual(generated);
  });

  it('encrypts with the SQS-managed KMS key by default', () => {
    queueTemplate().hasResourceProperties('AWS::SQS::Queue', { KmsMasterKeyId: 'alias/aws/sqs' });
  });

  it('encrypts with the SQS-managed KMS key when the caller passes encryption: undefined', () => {
    queueTemplate({ encryption: undefined }).hasResourceProperties('AWS::SQS::Queue', { KmsMasterKeyId: 'alias/aws/sqs' });
  });

  it('encrypts with the given KMS key when one is supplied', () => {
    queueTemplate({}, {}).hasResourceProperties('AWS::SQS::Queue', {
      KmsMasterKeyId: Match.objectLike({ 'Fn::GetAtt': [Match.stringLikeRegexp('^TestKey'), 'Arn'] }),
    });
  });

  describe('grantActions', () => {
    it('grants exactly sqs:SendMessage on the queue ARN for send, with no KMS statement on a queue without a key', () => {
      const { template, queueId } = grantOnQueue(SqsActions.send, false);

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayEquals([
            Match.objectEquals({ Action: 'sqs:SendMessage', Effect: 'Allow', Resource: { 'Fn::GetAtt': [queueId, 'Arn'] } }),
          ]),
        },
      });
    });

    it('grants exactly the consume actions on the queue ARN for consume, with no KMS statement on a queue without a key', () => {
      const { template, queueId } = grantOnQueue(SqsActions.consume, false);

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

    it('adds the send KMS statement to a send grant on a queue with a customer-managed key', () => {
      const { template, queueId, keyId } = grantOnQueue(SqsActions.send, true);

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayEquals([
            Match.objectEquals({ Action: 'sqs:SendMessage', Effect: 'Allow', Resource: { 'Fn::GetAtt': [queueId, 'Arn'] } }),
            Match.objectEquals({ Action: ['kms:GenerateDataKey*', 'kms:Decrypt'], Effect: 'Allow', Resource: { 'Fn::GetAtt': [keyId, 'Arn'] } }),
          ]),
        },
      });
    });

    it('adds the consume KMS statement to a consume grant on a queue with a customer-managed key', () => {
      const { template, queueId, keyId } = grantOnQueue(SqsActions.consume, true);

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
