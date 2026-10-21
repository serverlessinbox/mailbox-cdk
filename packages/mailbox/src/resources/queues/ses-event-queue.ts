import { BaseQueue, type BaseQueueProps, SqsActions, grantQueueActions } from '@serverlessinbox/mailbox-cdk-shared';
import { IGrantable, PolicyStatement, ServicePrincipal }                 from 'aws-cdk-lib/aws-iam';
import { IKey }                                                          from 'aws-cdk-lib/aws-kms';
import { SqsSubscription }                                               from 'aws-cdk-lib/aws-sns-subscriptions';
import { ITopic }                                                        from 'aws-cdk-lib/aws-sns';
import { QueueEncryption }                                               from 'aws-cdk-lib/aws-sqs';
import { Aws, Duration }                                                 from 'aws-cdk-lib';
import { Construct }                                                     from 'constructs';

/** Inputs of {@link SesEventQueue}. */
export interface SesEventQueueProps {
  /** The SNS topic this queue subscribes to for SES notifications. */
  readonly topic: ITopic;

  /** Optional default props applied to the queue (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * Lets a holder grant a caller permission to consume SES notifications from this queue, without
 * exposing the underlying SQS queue construct.
 */
export interface ISesEventQueue {
  /** The queue's ARN, needed to wire a consumer's own SQS event source mapping. */
  readonly queueArn: string;

  grantConsume(grantee: IGrantable): void;
}

/**
 * SQS queue subscribed to the SES-notifications SNS topic. `grantConsume` exposes only the SQS
 * actions a consumer needs.
 *
 * SNS cannot deliver to a queue encrypted with the AWS-managed SQS key (`alias/aws/sqs`), so this
 * queue defaults to unencrypted unless the caller supplies a customer-managed KMS key via
 * `queueProps.encryptionMasterKey` — in which case this construct also grants SNS permission to use
 * that key (imported keys that reject policy edits are the caller's responsibility to configure).
 *
 * Visibility timeout is 6 minutes; it must exceed the consumer's Lambda timeout plus its SQS event
 * source batching window.
 *
 * Not responsible for the topic itself or the SES configuration set; the topic is passed in.
 */
export class SesEventQueue extends Construct implements ISesEventQueue {
  public readonly queue: BaseQueue;
  public readonly queueArn: string;

  constructor(scope: Construct, id: string, props: SesEventQueueProps) {
    super(scope, id);

    const queueProps = props.queueProps ?? {};

    const encryption = queueProps.encryption
      ?? (queueProps.encryptionMasterKey ? QueueEncryption.KMS : QueueEncryption.UNENCRYPTED);

    this.queue    = new BaseQueue(this, 'ses-notifications-queue', {
      ...queueProps,
      visibilityTimeout: Duration.minutes(6),
      encryption,
    });
    this.queueArn = this.queue.queueArn;

    props.topic.addSubscription(
      new SqsSubscription(this.queue, {
        rawMessageDelivery: true,
      })
    );

    if (encryption === QueueEncryption.KMS && queueProps.encryptionMasterKey) {
      this.allowTopicToUseKey(queueProps.encryptionMasterKey, props.topic);
    }
  }

  public grantConsume(grantee: IGrantable): void {
    grantQueueActions(grantee, this.queue, SqsActions.consume);
  }

  private allowTopicToUseKey(key: IKey, topic: ITopic): void {
    key.addToResourcePolicy(
      new PolicyStatement({
        actions: [
          'kms:Decrypt',
          'kms:Encrypt',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:DescribeKey',
        ],
        principals: [new ServicePrincipal('sns.amazonaws.com')],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': Aws.ACCOUNT_ID,
          },
          ArnEquals: {
            'aws:SourceArn': topic.topicArn,
          },
        },
      })
    );
  }
}
