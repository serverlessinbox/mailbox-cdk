import type * as kms from 'aws-cdk-lib/aws-kms';

/**
 * Who owns the keys that encrypt the Mailbox's data at rest.
 *
 * - `'aws-managed'`: AWS-managed encryption. DynamoDB tables use the AWS-managed key, queues use the
 *   SQS-managed key and the blob store uses S3-managed encryption. No key is created or needed.
 * - `'customer-managed'`: keys you supply through {@link MailboxKmsConfig.key} and
 *   {@link MailboxKmsConfig.perResource}. The synth fails when a resource that is not excluded has
 *   no key.
 */
export type MailboxKmsMode = 'aws-managed' | 'customer-managed';

/**
 * A resource type that can be taken out of KMS encryption through {@link MailboxKmsConfig.excluded}.
 * The blob store cannot be excluded: it is always encrypted.
 */
export type MailboxKmsResource = 'dynamodb' | 'sqs';

/**
 * The key of each resource type, for when the types do not share {@link MailboxKmsConfig.key}. A
 * key left out falls back to {@link MailboxKmsConfig.key}.
 */
export interface MailboxKmsPerResourceConfig {
  /** Key for the S3 blob store that holds the email content. */
  readonly blobStore?: kms.IKey;
  /** Key for the DynamoDB tables. */
  readonly dynamoTables?: kms.IKey;
  /** Key for the SQS queues. */
  readonly queues?: kms.IKey;
}

/**
 * Settings for the at-rest encryption of the Mailbox's core resources: the DynamoDB tables, the
 * SQS queues and the S3 blob store. Without any setting, everything uses AWS-managed encryption.
 */
export interface MailboxKmsConfig {
  /**
   * Which keys encrypt the resources. `'none'` is `'aws-managed'` with every excludable resource
   * excluded: DynamoDB tables use the default AWS-owned encryption, queues are unencrypted and the
   * blob store keeps S3-managed encryption.
   *
   * @default 'aws-managed'
   */
  readonly mode?: MailboxKmsMode | 'none';

  /**
   * Resources to take out of KMS encryption. A DynamoDB table then uses the default AWS-owned
   * encryption and a queue is unencrypted. For example, `{ mode: 'aws-managed', excluded: ['dynamodb'] }`
   * keeps DynamoDB on default encryption while the queues stay KMS-encrypted.
   *
   * @default - no resource is excluded
   */
  readonly excluded?: MailboxKmsResource[];

  /**
   * One regional key for every resource type that has no key in `perResource`. Used only when
   * `mode` is `'customer-managed'`.
   *
   * @default - each resource type needs its key in `perResource`
   */
  readonly key?: kms.IKey;

  /**
   * Keys per resource type, taking precedence over `key`. Used only when `mode` is
   * `'customer-managed'`.
   *
   * @default - every resource type uses `key`
   */
  readonly perResource?: MailboxKmsPerResourceConfig;
}
