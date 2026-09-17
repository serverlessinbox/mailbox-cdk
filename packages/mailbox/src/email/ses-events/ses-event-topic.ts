import { Construct } from 'constructs';
import { Topic } from 'aws-cdk-lib/aws-sns';

/**
 * Read-only identity of the SES-notifications SNS topic. No grant method is exposed: the topic is
 * only ever read from inside this package (its ARN for the SES configuration-set event destination,
 * and the topic object itself to add the SQS subscription) — nothing outside grants an IAM
 * principal permission on it.
 */
export interface ISesEventTopic {
  readonly topicArn: string;
}

/**
 * SNS topic SES publishes bounce/complaint/delivery/send/reject notifications to. SES authorizes
 * publishing to this topic through the configuration-set event destination, not an IAM grant.
 *
 * Extends CDK's `Topic` directly, rather than wrapping one as a child, because this topic has no
 * explicit `topicName`: CloudFormation derives its physical name from the topic resource's own
 * logical ID. A wrapping construct would insert an extra node in front of it, moving that logical
 * ID (and therefore the deployed topic's identity) the moment this class was introduced.
 *
 * Not responsible for the SQS subscription or the SES configuration set — `SESEventProcessing`
 * wires those around this topic.
 */
export class SesEventTopic extends Topic implements ISesEventTopic {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      displayName: 'Mailbox SES Notifications',
    });
  }
}
