import { Aws, Duration } from 'aws-cdk-lib';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { ReceiptRule, ReceiptRuleSet, TlsPolicy } from 'aws-cdk-lib/aws-ses';
import { Sns, S3 } from 'aws-cdk-lib/aws-ses-actions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SqsSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { BaseQueue, type BaseQueueProps } from '../../utils/base-queue';

export interface EmailDelivery {
  emailBucket: IBucket;
  emailProcessor: IFunction;
  bucketPrefix: string;
  /** Encryption props forwarded from the mailbox encryption plan. */
  queueProps?: Partial<BaseQueueProps>;
}

export interface SesRulesProps {
  delivery: EmailDelivery;
}

export class SesRules extends Construct {
  constructor(scope: Construct, id: string, props: SesRulesProps) {
    super(scope, id);

    // Resolve queue encryption. SNS cannot publish to AWS-managed KMS queues because
    // the key policy is not customer-controllable. When a CMK is provided we use it and
    // grant SNS the necessary permissions; otherwise we fall back to SSE-SQS (SQS_MANAGED)
    // which is SNS-compatible and free.
    const queueEncryptionProps: Partial<BaseQueueProps> = (() => {
      const masterKey = props.delivery.queueProps?.encryptionMasterKey;
      if (masterKey) {
        return { encryption: QueueEncryption.KMS, encryptionMasterKey: masterKey };
      }
      return { encryption: QueueEncryption.SQS_MANAGED };
    })();

    // DLQ for emails that fail processing after all retries
    const dlq = new BaseQueue(this, 'email-processor-dlq', {
      ...queueEncryptionProps,
      retentionPeriod: Duration.days(14),
    });

    // SQS queue for email processing; visibility timeout must exceed Lambda timeout (1 min)
    const queue = new BaseQueue(this, 'email-processor-queue', {
      ...queueEncryptionProps,
      visibilityTimeout: Duration.minutes(6),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // SNS topic receives SES delivery notifications and fans out to SQS
    const topic = new Topic(this, 'email-delivery-topic');

    // When using a CMK, SNS needs kms:GenerateDataKey* and kms:Decrypt to publish
    const masterKey = props.delivery.queueProps?.encryptionMasterKey;
    if (masterKey) {
      masterKey.grant(new ServicePrincipal('sns.amazonaws.com'),
        'kms:GenerateDataKey*',
        'kms:Decrypt',
      );
    }
    topic.addSubscription(new SqsSubscription(queue));

    // SES receipt rule set
    const ruleSet = new ReceiptRuleSet(this, 'email-rule-set', {});

    // SES receipt rule: store email in S3, then notify via SNS → SQS → Lambda
    new ReceiptRule(this, 'email-rule', {
      ruleSet: ruleSet,
      actions: [
        new S3({
          bucket: props.delivery.emailBucket,
          objectKeyPrefix: 'incoming-emails/',
        }),
        new Sns({ topic }),
      ],
      enabled: true,
      scanEnabled: true,
      tlsPolicy: TlsPolicy.REQUIRE,
    });

    // Trigger email-processor Lambda from the queue; partial batch failure reporting
    // ensures only failed messages are retried, not the entire batch
    props.delivery.emailProcessor.addEventSource(new SqsEventSource(queue, {
      batchSize: 10,
      reportBatchItemFailures: true,
    }));

    // IAM policy for SES to write to S3
    const sesS3Policy = new PolicyStatement({
      effect: Effect.ALLOW,
      principals: [new ServicePrincipal('ses.amazonaws.com')],
      actions: ['s3:PutObject'],
      resources: [`${props.delivery.emailBucket.bucketArn}/${props.delivery.bucketPrefix}*`],
      conditions: {
        StringEquals: {
          'aws:SourceAccount': Aws.ACCOUNT_ID,
        },
      },
    });

    props.delivery.emailBucket.addToResourcePolicy(sesS3Policy);
  }
}
