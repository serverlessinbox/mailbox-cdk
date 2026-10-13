import { Construct } from 'constructs';
import { Queue, QueueEncryption, QueueProps } from 'aws-cdk-lib/aws-sqs';
import { Duration } from 'aws-cdk-lib';
import { makePhysicalName } from './naming/resource-names';

export interface BaseQueueProps extends Omit<QueueProps, 'visibilityTimeout' | 'receiveMessageWaitTime'> {
  /**
   * Optional custom visibility timeout (default: 6 minutes).
   *
   * IMPORTANT: If this queue has a Lambda event-source mapping, the visibility timeout must exceed
   * the Lambda's timeout + maxBatchingWindow by a safe margin (typically 30-60 seconds).
   * Failure to set an appropriate timeout can cause messages to become visible again before the
   * invocation completes, resulting in duplicate processing.
   *
   * Example: A Lambda with 5-minute timeout and 30-second batching window requires at least 5m30s.
   * Set visibilityTimeout to Duration.minutes(6) or higher as appropriate.
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
 * - Visibility timeout: 6 minutes (safe for most Lambda consumers with 5m timeout and <60s batching)
 * - Long polling: 20 seconds
 *
 * WARNING: The default visibility timeout assumes a Lambda consumer with ~5 minute timeout and up to
 * 60 seconds of batching/processing time. If your queue is consumed by a Lambda with different
 * characteristics, you MUST override visibilityTimeout with a value that exceeds:
 * (Lambda timeout) + (maxBatchingWindow) + (processing headroom, e.g. 30 seconds)
 *
 * Queues without Lambda consumers do not need to override this.
 */
export class BaseQueue extends Queue {
  constructor(scope: Construct, id: string, props?: BaseQueueProps) {
    const {
      visibilityTimeout = Duration.minutes(6),
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
