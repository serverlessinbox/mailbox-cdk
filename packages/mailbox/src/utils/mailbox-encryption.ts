import { Construct } from 'constructs';
import { BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { TableEncryption, type TableProps } from 'aws-cdk-lib/aws-dynamodb';
import { QueueEncryption } from 'aws-cdk-lib/aws-sqs';

import type { BlobStoreProps } from '../resources/blob-store';
import type { BaseQueueProps } from './base-queue';
import type { MailboxKmsConfig } from './kms';
import { mailboxKmsExcluded, mailboxKmsMode, resolveDynamoTablesKey, resolveBlobStoreKey, resolveQueuesKey } from './kms';

export interface MailboxEncryptionPlan {
  readonly blobStore: BlobStoreProps;
  readonly dynamoTables: Partial<TableProps>;
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
    const excluded = mailboxKmsExcluded('s3', kms);
    const key = mailboxKmsMode(kms) === 'customer-managed' && !excluded
      ? resolveBlobStoreKey(scope, kms)
      : undefined;

    if (mailboxKmsMode(kms) === 'customer-managed' && !excluded && !key) {
      throw new Error("MailboxProps.kms.mode is 'customer-managed' but no S3 KMS key was provided for the blob store");
    }

    return {
      encryption: excluded ? BucketEncryption.S3_MANAGED : undefined,
      encryptionKey: key,
    } satisfies BlobStoreProps;
  })();

  return {
    blobStore,
    dynamoTables,
    queues,
  };
}
