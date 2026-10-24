/**
 * A resource type that can be taken out of KMS encryption through `MailboxKmsConfig.excluded`.
 * The blob store cannot be excluded: it is always encrypted.
 */
export enum MailboxKmsResource {
  /** The DynamoDB tables. An excluded table uses the default AWS-owned encryption. */
  DYNAMODB = 'dynamodb',
  /** The SQS queues. An excluded queue is unencrypted. */
  SQS = 'sqs',
}
