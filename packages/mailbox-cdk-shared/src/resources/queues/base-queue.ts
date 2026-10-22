import { Queue, QueueEncryption, QueueProps } from 'aws-cdk-lib/aws-sqs';
import { Duration }                           from 'aws-cdk-lib';
import { Construct }                          from 'constructs';

import { makePhysicalName }                   from '../../naming/resource-names';

/** Queue props for {@link BaseQueue}: every SQS queue prop, with the visibility timeout and long-poll wait optional. */
export interface BaseQueueProps extends Omit<QueueProps, 'visibilityTimeout' | 'receiveMessageWaitTime'> {
  /**
   * Visibility timeout (default: 6 minutes).
   *
   * A queue read through a Lambda event-source mapping needs a visibility timeout that exceeds the
   * function timeout plus the maxBatchingWindow by a safe margin (typically 30-60 seconds); otherwise
   * messages become visible again before the invocation completes and are processed twice.
   * Example: a 5-minute function timeout with a 30-second batching window requires at least 5m30s.
   */
  readonly visibilityTimeout?: Duration;

  /** Receive message wait time (default: 20 seconds, long polling). */
  readonly receiveMessageWaitTime?: Duration;
}

/**
 * An SQS queue with a 6-minute visibility timeout, 20-second long polling and SQS-managed (or, with an
 * `encryptionMasterKey`, KMS) encryption.
 *
 * The default visibility timeout suits a Lambda consumer with a ~5-minute timeout and up to 60 seconds
 * of batching. For a consumer with other characteristics, override `visibilityTimeout` with a value
 * above (function timeout) + (maxBatchingWindow) + (processing headroom, e.g. 30 seconds).
 */
export class BaseQueue extends Queue {
  constructor(scope: Construct, id: string, props: BaseQueueProps = {}) {
    const {
      visibilityTimeout = Duration.minutes(6),
      receiveMessageWaitTime = Duration.seconds(20),
      ...rest
    } = props;

    const queueName = rest.queueName ?? makePhysicalName(scope, id, { maxLength: 80 });

    const encryption = rest.encryption
      ?? (rest.encryptionMasterKey ? QueueEncryption.KMS : QueueEncryption.KMS_MANAGED);

    super(scope, id, {
      visibilityTimeout,
      receiveMessageWaitTime,
      ...rest,
      encryption,
      queueName,
    });
  }
}
