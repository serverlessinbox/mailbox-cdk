import type { IArtifactResolver }     from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                   from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                   from 'aws-cdk-lib';
import { Construct }                  from 'constructs';

import type { IEmailProcessingQueue } from '../queues/email-processing-queue';

export interface SesReceiptForwarderLambdaProps {
  emailProcessorQueue: IEmailProcessingQueue;
  artifactResolver:    IArtifactResolver;
}

/**
 * Tiny Lambda invoked by the SES receipt rule (async / InvocationType.EVENT).
 *
 * It receives the SES receipt notification (mail + receipt metadata, no email body),
 * and enqueues it onto the email-processor SQS queue. This avoids the 150 KB size
 * limit of the SES SNS action, which would otherwise bounce large inbound emails.
 *
 * SES invokes this asynchronously so a transient failure does NOT cause a bounce —
 * the raw email is already safely stored in S3 before this Lambda is called.
 */
export class SesReceiptForwarderLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: SesReceiptForwarderLambdaProps) {
    super(scope, id, {
      lambdaId:         'ses-receipt-forwarder',
      pipeline:         'mail-in',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.seconds(30),
      memorySize:       128,
      environment:      {
        EMAIL_PROCESSOR_QUEUE_URL: props.emailProcessorQueue.queueUrl,
      },
    });

    props.emailProcessorQueue.grantSend(this);
  }
}
