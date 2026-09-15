import { Construct } from 'constructs';
import { Queue, QueueEncryption, QueueProps } from 'aws-cdk-lib/aws-sqs';
import { Duration } from 'aws-cdk-lib';
import { makePhysicalName } from './resource-names';

export interface BaseQueueProps extends Omit<QueueProps, 'visibilityTimeout' | 'receiveMessageWaitTime'> {
  /**
   * Optional custom visibility timeout (default: 5 minutes)
   */
  visibilityTimeout?: Duration;
  
  /**
   * Optional custom receive message wait time (default: 20 seconds for long polling)
   */
  receiveMessageWaitTime?: Duration;
}

/**
 * Base Queue construct with standard settings for Mailbox
 * 
 * Provides sensible defaults:
 * - Visibility timeout: 5 minutes
 * - Long polling: 20 seconds
 */
export class BaseQueue extends Queue {
  constructor(scope: Construct, id: string, props?: BaseQueueProps) {
    const {
      visibilityTimeout = Duration.minutes(5),
      receiveMessageWaitTime = Duration.seconds(20),
      ...rest
    } = props || {};

    const queueName = rest.queueName ?? makePhysicalName(scope, id, { maxLength: 80 });

    const encryption = rest.encryption
      ?? (rest.encryptionMasterKey ? QueueEncryption.KMS : QueueEncryption.KMS_MANAGED);

    super(scope, id, {
      visibilityTimeout,
      receiveMessageWaitTime,
      queueName,
      encryption,
      ...rest,
    });
  }
}
