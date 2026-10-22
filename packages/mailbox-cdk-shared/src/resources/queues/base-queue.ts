import { Grant, IGrantable }                  from 'aws-cdk-lib/aws-iam';
import { Queue, QueueEncryption, QueueProps } from 'aws-cdk-lib/aws-sqs';
import { Duration }                           from 'aws-cdk-lib';
import { Construct }                          from 'constructs';

import { SqsActions }                         from '../../grants/sqs-actions';
import type { SqsAction }                     from '../../grants/sqs-actions';
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

  /** Grants `grantee` exactly `SqsActions.send` on this queue, plus the KMS actions a producer needs on a customer-managed key. */
  public grantSend(grantee: IGrantable): Grant {
    return this.grantActions(grantee, SqsActions.send);
  }

  /** Grants `grantee` exactly `SqsActions.consume` on this queue, plus the KMS action a consumer needs on a customer-managed key. */
  public grantConsume(grantee: IGrantable): Grant {
    return this.grantActions(grantee, SqsActions.consume);
  }

  /**
   * Grants `grantee` exactly the given SQS actions on this queue, scoped to the queue's ARN. If the
   * queue uses a customer-managed KMS key (`encryptionMasterKey`), also grants the matching key
   * actions, so a caller granted `SqsActions.send`/`SqsActions.consume` never needs to reason about
   * the queue's encryption separately from its message actions.
   */
  protected grantActions(grantee: IGrantable, actions: readonly SqsAction[]): Grant {
    const grant = Grant.addToPrincipal({
      grantee,
      actions:      [...actions],
      resourceArns: [this.queueArn],
    });

    this.grantEncryptionKey(grantee, actions);

    return grant;
  }

  /**
   * SQS performs the envelope encryption itself: a producer never calls kms:Encrypt or kms:ReEncrypt*
   * directly. It needs kms:GenerateDataKey* to have SQS mint a fresh data key, and kms:Decrypt because
   * SQS caches the encrypted data key and decrypts it on subsequent sends within the cache window.
   */
  private grantEncryptionKey(grantee: IGrantable, actions: readonly SqsAction[]): void {
    const key = this.encryptionMasterKey;
    if (!key) {
      return;
    }

    if (actions.includes('sqs:SendMessage')) {
      key.grant(grantee, 'kms:GenerateDataKey*', 'kms:Decrypt');
    } else if (actions.includes('sqs:ReceiveMessage')) {
      key.grant(grantee, 'kms:Decrypt');
    }
  }
}
