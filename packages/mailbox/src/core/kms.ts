import type * as kms               from 'aws-cdk-lib/aws-kms';

import type { MailboxKmsMode }     from './mailbox-kms-mode';
import type { MailboxKmsResource } from './mailbox-kms-resource';

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
   * Which keys encrypt the resources. `MailboxKmsMode.NONE` is `MailboxKmsMode.AWS_MANAGED` with every
   * excludable resource excluded: DynamoDB tables use the default AWS-owned encryption, queues are
   * unencrypted and the blob store keeps S3-managed encryption.
   *
   * @default MailboxKmsMode.AWS_MANAGED
   */
  readonly mode?: MailboxKmsMode;

  /**
   * Resources to take out of KMS encryption. A DynamoDB table then uses the default AWS-owned
   * encryption and a queue is unencrypted. For example, `{ mode: MailboxKmsMode.AWS_MANAGED,
   * excluded: [MailboxKmsResource.DYNAMODB] }` keeps DynamoDB on default encryption while the queues
   * stay KMS-encrypted.
   *
   * @default - no resource is excluded
   */
  readonly excluded?: MailboxKmsResource[];

  /**
   * One regional key for every resource type that has no key in `perResource`. Used only when
   * `mode` is `MailboxKmsMode.CUSTOMER_MANAGED`.
   *
   * @default - each resource type needs its key in `perResource`
   */
  readonly key?: kms.IKey;

  /**
   * Keys per resource type, taking precedence over `key`. Used only when `mode` is
   * `MailboxKmsMode.CUSTOMER_MANAGED`.
   *
   * @default - every resource type uses `key`
   */
  readonly perResource?: MailboxKmsPerResourceConfig;
}
