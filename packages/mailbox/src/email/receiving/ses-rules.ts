import { CfnOutput, Duration } from 'aws-cdk-lib';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IReceiptRuleSet, ReceiptRule, ReceiptRuleSet, TlsPolicy } from 'aws-cdk-lib/aws-ses';
import { Lambda, LambdaInvocationType, S3 } from 'aws-cdk-lib/aws-ses-actions';
import { QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { BaseQueue, type BaseQueueProps } from '../../utils/base-queue';
import { SesReceiptForwarderLambda } from '../../lambdas/ses-receipt-forwarder';
import type { ICdkArtifactResolver } from '@serverlessinbox/mailbox-cdk-shared';

export interface EmailDelivery {
  readonly blobStore: IBucket;
  readonly emailProcessor: IFunction;
  readonly bucketPrefix: string;
  readonly artifactResolver: ICdkArtifactResolver;
  /** Encryption props forwarded from the mailbox encryption plan. */
  readonly queueProps?: Partial<BaseQueueProps>;
}

export interface SesRulesProps {
  readonly delivery: EmailDelivery;
}

export class SesRules extends Construct {
  /** The name of the SES receipt rule set created by this construct. */
  readonly ruleSetName: string;
  /** The SES receipt rule set object (typed CDK interface for passing to other constructs). */
  readonly ruleSet: IReceiptRuleSet;

  constructor(scope: Construct, id: string, props: SesRulesProps) {
    super(scope, id);

    const queueEncryptionProps: Partial<BaseQueueProps> = (() => {
      const masterKey = props.delivery.queueProps?.encryptionMasterKey;
      if (masterKey) {
        return { encryption: QueueEncryption.KMS, encryptionMasterKey: masterKey };
      }
      return { encryption: QueueEncryption.SQS_MANAGED };
    })();

    // DLQ for emails that fail processing after all retries
    const dlq = new BaseQueue(this, 'email-processing-dlq', {
      ...queueEncryptionProps,
      retentionPeriod: Duration.days(14),
    });

    // SQS queue for email processing; visibility timeout must exceed Lambda timeout (1 min)
    const queue = new BaseQueue(this, 'email-processing-queue', {
      ...queueEncryptionProps,
      visibilityTimeout: Duration.minutes(6),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // Forwarder Lambda: receives the SES receipt notification and enqueues it on SQS.
    // This replaces the SNS action which has a hard 150 KB inbound email size limit.
    // SES invokes this asynchronously (InvocationType.EVENT) so a transient failure
    // does NOT bounce the email — the MIME is already safely stored in S3.
    const forwarder = new SesReceiptForwarderLambda(this, 'ses-receipt-forwarder', {
      emailProcessorQueue: queue,
      artifactResolver: props.delivery.artifactResolver,
    });

    // SES receipt rule set
    const ruleSet = new ReceiptRuleSet(this, 'email-rule-set', {});
    this.ruleSetName = ruleSet.receiptRuleSetName;
    this.ruleSet = ruleSet;

    // SES receipt rule: store email in S3, then notify via Lambda → SQS → email-processor
    new ReceiptRule(this, 'email-rule', {
      ruleSet: ruleSet,
      actions: [
        new S3({
          bucket: props.delivery.blobStore,
          objectKeyPrefix: 'incoming-emails/',
        }),
        new Lambda({
          function: forwarder,
          invocationType: LambdaInvocationType.EVENT, // async — SES does not wait for the result
        }),
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

    // Note: the SES bucket policy (allowing ses.amazonaws.com to s3:PutObject on incoming-emails/*)
    // is applied directly on BlobStore in resources/blob-store.ts. The blob store is owned by
    // MailboxDataStack and referenced here as an imported IBucket; addToResourcePolicy on imported
    // buckets is a CDK no-op, so the policy must live on the owning construct instead.

    new CfnOutput(this, 'SesReceiptRuleSetName', {
      value: ruleSet.receiptRuleSetName,
      exportName: 'SesReceiptRuleSetName',
    });
  }
}
