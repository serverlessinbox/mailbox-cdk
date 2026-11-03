import type { IKey } from 'aws-cdk-lib/aws-kms';

/** Queue encrypted with the SQS-managed key. */
export interface AwsManagedQueueEncryption { readonly kind: 'aws-managed'; }
/** Queue stored unencrypted. */
export interface UnencryptedQueueEncryption { readonly kind: 'unencrypted'; }
/** Queue encrypted with a customer-managed KMS key. */
export interface KmsQueueEncryption { readonly kind: 'kms'; readonly key: IKey; }

export type QueueEncryptionChoice = AwsManagedQueueEncryption | UnencryptedQueueEncryption | KmsQueueEncryption;
