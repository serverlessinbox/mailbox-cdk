import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { IQueue }            from 'aws-cdk-lib/aws-sqs';

const SEND = ['sqs:SendMessage'] as const;

/**
 * The permissions AWS documents as required for a Lambda execution role consuming an SQS event
 * source mapping (the `AWSLambdaSQSQueueExecutionRole` managed policy's queue actions). Deliberately
 * narrower than CDK's `IQueue.grantConsumeMessages`, which also grants `sqs:ChangeMessageVisibility`
 * and `sqs:GetQueueUrl` — actions AWS does not list as required for this integration.
 */
const CONSUME = ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'] as const;

/**
 * Explicit least-privilege SQS action sets — `send` and `consume` — for use with
 * `grantQueueActions`. `send` covers both `SendMessage` and `SendMessageBatch` calls: SQS has no
 * separate IAM action for the batch API, `sqs:SendMessage` authorizes both.
 */
export const SqsActions = {
  send: SEND,
  consume: CONSUME,
} as const;

/**
 * Grants a caller exactly the given SQS actions on a queue, scoped to the queue's ARN. If the queue
 * uses a customer-managed KMS key (`encryptionMasterKey`), also grants the matching key actions, so
 * a caller granted `SqsActions.send`/`SqsActions.consume` never needs to reason about the queue's
 * encryption separately from its message actions.
 */
export function grantQueueActions(grantee: IGrantable, queue: IQueue, actions: readonly string[]): Grant {
  const grant = Grant.addToPrincipal({
    grantee,
    actions: [...actions],
    resourceArns: [queue.queueArn],
  });

  const key = queue.encryptionMasterKey;
  if (key) {
    // SQS performs the envelope encryption itself: a producer never calls kms:Encrypt or
    // kms:ReEncrypt* directly. It needs kms:GenerateDataKey* to have SQS mint a fresh data key,
    // and kms:Decrypt because SQS caches the encrypted data key and decrypts it on subsequent
    // sends within the cache window.
    if (actions.includes('sqs:SendMessage')) {
      key.grant(grantee, 'kms:GenerateDataKey*', 'kms:Decrypt');
    } else if (actions.includes('sqs:ReceiveMessage')) {
      key.grant(grantee, 'kms:Decrypt');
    }
  }

  return grant;
}
