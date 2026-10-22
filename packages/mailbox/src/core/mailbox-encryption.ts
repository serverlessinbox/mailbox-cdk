import type { BaseQueueProps }                                                                               from '@serverlessinbox/mailbox-cdk-shared';
import { TableEncryption }                                                                                   from 'aws-cdk-lib/aws-dynamodb';
import { QueueEncryption }                                                                                   from 'aws-cdk-lib/aws-sqs';
import { Construct }                                                                                         from 'constructs';

import type { BlobStoreEncryptionProps }                                                                     from '../resources/buckets/blob-store';
import type { DynamoTableEncryptionProps }                                                                   from '../resources/tables/data-table-props';

import type { MailboxKmsConfig }                                                                             from './kms';
import { mailboxKmsExcluded, mailboxKmsMode, resolveDynamoTablesKey, resolveBlobStoreKey, resolveQueuesKey } from './kms';

export interface MailboxEncryptionPlan {
  readonly blobStore:    BlobStoreEncryptionProps;
  readonly dynamoTables: DynamoTableEncryptionProps;
  /**
   * Default props for queues created via BaseQueue.
   * - `undefined` means "use BaseQueue defaults".
   */
  readonly queues?: Partial<BaseQueueProps>;
}

export function resolveMailboxEncryptionPlan(scope: Construct, kms?: MailboxKmsConfig): MailboxEncryptionPlan {
  const dynamoTables = (() => {
    if (mailboxKmsExcluded('dynamodb', kms)) {
      return { encryption: TableEncryption.DEFAULT };
    }

    if (mailboxKmsMode(kms) === 'aws-managed') {
      return { encryption: TableEncryption.AWS_MANAGED };
    }

    const key = resolveDynamoTablesKey(scope, kms);
    if (!key) {
      throw new Error("MailboxProps.kms.mode is 'customer-managed' but no DynamoDB KMS key was provided");
    }
    return { encryption: TableEncryption.CUSTOMER_MANAGED, encryptionKey: key };
  })();

  const queues = (() => {
    if (mailboxKmsExcluded('sqs', kms)) {
      return { encryption: QueueEncryption.UNENCRYPTED };
    }

    if (mailboxKmsMode(kms) === 'aws-managed') {
      // Let BaseQueue default to KMS-managed.
      return undefined;
    }

    const key = resolveQueuesKey(scope, kms);
    if (!key) {
      throw new Error("MailboxProps.kms.mode is 'customer-managed' but no SQS KMS key was provided");
    }
    return { encryption: QueueEncryption.KMS, encryptionMasterKey: key };
  })();

  const blobStore = (() => {
    const key = mailboxKmsMode(kms) === 'customer-managed'
      ? resolveBlobStoreKey(scope, kms)
      : undefined;

    if (mailboxKmsMode(kms) === 'customer-managed' && !key) {
      throw new Error("MailboxProps.kms.mode is 'customer-managed' but no S3 KMS key was provided for the blob store");
    }

    return {
      encryptionKey: key,
    } satisfies BlobStoreEncryptionProps;
  })();

  return {
    blobStore,
    dynamoTables,
    queues,
  };
}
