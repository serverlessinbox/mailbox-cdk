import type { BaseQueueProps }                                       from '@serverlessinbox/mailbox-cdk-shared';
import { TableEncryption }                                           from 'aws-cdk-lib/aws-dynamodb';
import { QueueEncryption }                                           from 'aws-cdk-lib/aws-sqs';

import type { BlobStoreEncryptionProps }                             from '../resources/buckets/blob-store';
import type { DynamoTableEncryptionProps }                           from '../resources/tables/data-table-props';

import type { MailboxKmsConfig }                                     from './kms';
import { MailboxKmsMode }                                            from './mailbox-kms-mode';
import { MailboxKmsResource }                                        from './mailbox-kms-resource';

/** How each kind of data resource is encrypted, as the resources take it: tables, blob store and queue defaults. */
export interface MailboxEncryptionPlan {
  readonly blobStore:    BlobStoreEncryptionProps;
  readonly dynamoTables: DynamoTableEncryptionProps;
  /**
   * Default props for queues created via BaseQueue.
   * - `undefined` means "use BaseQueue defaults".
   */
  readonly queues?: Partial<BaseQueueProps>;
}

/**
 * Turns the KMS settings of a Mailbox into the encryption each resource type is created with.
 *
 * In `aws-managed` mode no key is passed on at all: the tables and the queues take their AWS-managed
 * encryption by type and the blob store takes S3-managed encryption.
 */
export class MailboxEncryption {
  /** The plan for `config`; a resource that needs a customer-managed key and has none fails the synth. */
  public static plan(config?: MailboxKmsConfig): MailboxEncryptionPlan {
    return {
      dynamoTables: MailboxEncryption.dynamoTablesPlan(config),
      queues:       MailboxEncryption.queuesPlan(config),
      blobStore:    MailboxEncryption.blobStorePlan(config),
    };
  }

  private static dynamoTablesPlan(config?: MailboxKmsConfig): DynamoTableEncryptionProps {
    if (MailboxEncryption.isExcluded(MailboxKmsResource.DYNAMODB, config)) {
      return { encryption: TableEncryption.DEFAULT };
    }

    if (MailboxEncryption.modeOf(config) === MailboxKmsMode.AWS_MANAGED) {
      return { encryption: TableEncryption.AWS_MANAGED };
    }

    const key = config?.perResource?.dynamoTables ?? config?.key;
    if (!key) {
      throw new Error("MailboxProps.kms.mode is 'customer-managed' but no DynamoDB KMS key was provided");
    }
    return { encryption: TableEncryption.CUSTOMER_MANAGED, encryptionKey: key };
  }

  private static queuesPlan(config?: MailboxKmsConfig): Partial<BaseQueueProps> | undefined {
    if (MailboxEncryption.isExcluded(MailboxKmsResource.SQS, config)) {
      return { encryption: QueueEncryption.UNENCRYPTED };
    }

    if (MailboxEncryption.modeOf(config) === MailboxKmsMode.AWS_MANAGED) {
      return undefined;
    }

    const key = config?.perResource?.queues ?? config?.key;
    if (!key) {
      throw new Error("MailboxProps.kms.mode is 'customer-managed' but no SQS KMS key was provided");
    }
    return { encryption: QueueEncryption.KMS, encryptionMasterKey: key };
  }

  private static blobStorePlan(config?: MailboxKmsConfig): BlobStoreEncryptionProps {
    if (MailboxEncryption.modeOf(config) === MailboxKmsMode.AWS_MANAGED) {
      return { encryptionKey: undefined };
    }

    const key = config?.perResource?.blobStore ?? config?.key;
    if (!key) {
      throw new Error("MailboxProps.kms.mode is 'customer-managed' but no S3 KMS key was provided for the blob store");
    }
    return { encryptionKey: key };
  }

  /** The mode in force; `NONE` is `AWS_MANAGED` with every resource excluded. */
  private static modeOf(config?: MailboxKmsConfig): MailboxKmsMode {
    const mode = config?.mode ?? MailboxKmsMode.AWS_MANAGED;
    return mode === MailboxKmsMode.NONE ? MailboxKmsMode.AWS_MANAGED : mode;
  }

  private static isExcluded(resource: MailboxKmsResource, config?: MailboxKmsConfig): boolean {
    return config?.mode === MailboxKmsMode.NONE || (config?.excluded ?? []).includes(resource);
  }
}
