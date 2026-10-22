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
 * `BaseQueue.grantActions`. `send` covers both `SendMessage` and `SendMessageBatch` calls: SQS has no
 * separate IAM action for the batch API, `sqs:SendMessage` authorizes both.
 */
export const SqsActions = {
  send:    SEND,
  consume: CONSUME,
} as const;

/** One SQS action of the sets in {@link SqsActions}. */
export type SqsAction = typeof SEND[number] | typeof CONSUME[number];
