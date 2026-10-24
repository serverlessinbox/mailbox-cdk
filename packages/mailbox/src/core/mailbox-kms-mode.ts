/**
 * Who owns the keys that encrypt the Mailbox's data at rest.
 */
export enum MailboxKmsMode {
  /**
   * AWS-managed encryption. DynamoDB tables use the AWS-managed key, queues use the SQS-managed key
   * and the blob store uses S3-managed encryption. No key is created or needed.
   */
  AWS_MANAGED = 'aws-managed',

  /**
   * Keys you supply through `MailboxKmsConfig.key` and `MailboxKmsConfig.perResource`. The synth
   * fails when a resource that is not excluded has no key.
   */
  CUSTOMER_MANAGED = 'customer-managed',

  /**
   * AWS-managed encryption with every excludable resource excluded: DynamoDB tables use the default
   * AWS-owned encryption, queues are unencrypted and the blob store keeps S3-managed encryption.
   */
  NONE = 'none',
}
