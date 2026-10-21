import type { IArtifactResolver }                                   from '@serverlessinbox/artifact-registry-cdk';
import { type BaseQueueProps }                                      from '@serverlessinbox/mailbox-cdk-shared';
import { IBucket }                                                  from 'aws-cdk-lib/aws-s3';
import { Lambda, LambdaInvocationType, S3 }                         from 'aws-cdk-lib/aws-ses-actions';
import { IReceiptRuleSet, ReceiptRule, ReceiptRuleSet, TlsPolicy }  from 'aws-cdk-lib/aws-ses';
import { Construct }                                                from 'constructs';

import { SesReceiptForwarderLambda }                                from '../../resources/lambdas/ses-receipt-forwarder-lambda';
import { BlobStore }                                                from '../../resources/blob-store';

import { EmailProcessingQueue, type IEmailProcessingQueueConsumer } from './email-processing-queue';

/** Where received email is stored and how it is queued for processing. */
export interface EmailDelivery {
  readonly blobStore: IBucket;
  readonly artifactResolver: IArtifactResolver;
  /** Encryption props forwarded from the mailbox encryption plan. */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/** Inputs of {@link SesRules}. */
export interface SesRulesProps {
  readonly delivery: EmailDelivery;
}

/**
 * The SES receiving side: a receipt rule set with one rule that stores each incoming email in S3
 * and then notifies a forwarder Lambda, which enqueues it on the email-processing queue.
 *
 * It does not consume the queue it creates.
 */
export class SesRules extends Construct {
  /** The name of the SES receipt rule set created by this construct. */
  readonly ruleSetName: string;
  /** The SES receipt rule set object (typed CDK interface for passing to other constructs). */
  readonly ruleSet: IReceiptRuleSet;
  /** Send/consume handle to the email-processing queue this construct creates. */
  readonly emailProcessingQueue: IEmailProcessingQueueConsumer;

  constructor(scope: Construct, id: string, props: SesRulesProps) {
    super(scope, id);

    const emailProcessingQueue = new EmailProcessingQueue(this, 'email-processing-queue', {
      queueProps: props.delivery.queueProps,
    });
    this.emailProcessingQueue  = emailProcessingQueue;

    // SES's SNS action has a hard 150 KB limit on the inbound email, so the notification goes
    // through a forwarder Lambda that enqueues it on SQS instead.
    const forwarder = new SesReceiptForwarderLambda(this, 'ses-receipt-forwarder', {
      emailProcessorQueue: emailProcessingQueue,
      artifactResolver: props.delivery.artifactResolver,
    });

    const ruleSet    = new ReceiptRuleSet(this, 'email-rule-set', {});
    this.ruleSetName = ruleSet.receiptRuleSetName;
    this.ruleSet     = ruleSet;

    new ReceiptRule(this, 'email-rule', {
      ruleSet: ruleSet,
      actions: [
        new S3({
          bucket: props.delivery.blobStore,
          objectKeyPrefix: BlobStore.INCOMING_EMAIL_PREFIX,
        }),
        new Lambda({
          function: forwarder,
          // Asynchronous, so SES does not wait for the result: a transient forwarder failure does
          // not bounce the email, whose MIME is already stored in S3.
          invocationType: LambdaInvocationType.EVENT,
        }),
      ],
      enabled: true,
      scanEnabled: true,
      tlsPolicy: TlsPolicy.REQUIRE,
    });
  }
}
