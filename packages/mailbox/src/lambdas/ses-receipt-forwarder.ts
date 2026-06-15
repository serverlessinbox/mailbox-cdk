import { Duration } from 'aws-cdk-lib';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import type { ICdkArtifactResolver } from '../artifacts/cdk-artifact-resolver';
import { GoLambda } from '../utils/go-lambda';

export interface SesReceiptForwarderLambdaProps {
  emailProcessorQueue: IQueue;
  artifactResolver: ICdkArtifactResolver;
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
      lambdaId: 'ses-receipt-forwarder',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      memorySize: 128,
      environment: {
        EMAIL_PROCESSOR_QUEUE_URL: props.emailProcessorQueue.queueUrl,
      },
    });

    props.emailProcessorQueue.grantSendMessages(this);
  }
}
