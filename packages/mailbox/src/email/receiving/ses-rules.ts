import { CfnOutput } from 'aws-cdk-lib';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IReceiptRuleSet, ReceiptRule, ReceiptRuleSet, TlsPolicy } from 'aws-cdk-lib/aws-ses';
import { Lambda, LambdaInvocationType, S3 } from 'aws-cdk-lib/aws-ses-actions';
import { Construct } from 'constructs';
import { type BaseQueueProps } from '@serverlessinbox/mailbox-cdk-shared';
import { SesReceiptForwarderLambda } from '../../lambdas/ses-receipt-forwarder';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { EmailProcessingQueue, type IEmailProcessingQueueConsumer } from './email-processing-queue';

export interface EmailDelivery {
  readonly blobStore: IBucket;
  readonly bucketPrefix: string;
  readonly artifactResolver: ICdkArtifactEngine;
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
  /** Send/consume handle to the email-processing queue this construct creates. */
  readonly emailProcessingQueue: IEmailProcessingQueueConsumer;

  constructor(scope: Construct, id: string, props: SesRulesProps) {
    super(scope, id);

    // SQS queue for email processing (with its DLQ); visibility timeout must exceed the
    // email-processor Lambda's timeout (1 min).
    const emailProcessingQueue = new EmailProcessingQueue(this, 'email-processing-queue', {
      queueProps: props.delivery.queueProps,
    });
    this.emailProcessingQueue = emailProcessingQueue;

    // Forwarder Lambda: receives the SES receipt notification and enqueues it on SQS.
    // This replaces the SNS action which has a hard 150 KB inbound email size limit.
    // SES invokes this asynchronously (InvocationType.EVENT) so a transient failure
    // does NOT bounce the email — the MIME is already safely stored in S3.
    const forwarder = new SesReceiptForwarderLambda(this, 'ses-receipt-forwarder', {
      emailProcessorQueue: emailProcessingQueue,
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
