import { Construct } from 'constructs';
import * as kms from 'aws-cdk-lib/aws-kms';

export type MailboxKmsMode = 'aws-managed' | 'customer-managed';

export type MailboxKmsResource = 's3' | 'dynamodb' | 'sqs';

export interface MailboxKmsPerResourceConfig {
  readonly emailBucket?: kms.IKey;
  readonly dynamoTables?: kms.IKey;
  readonly queues?: kms.IKey;
}

export interface MailboxKmsConfig {
  /**
   * Default: 'aws-managed'
   * - 'none': do not use KMS for resources that support disabling it (S3/SQS); DynamoDB uses AWS-owned encryption.
   * - 'aws-managed': use AWS-managed keys (e.g. alias/aws/s3)
   * - 'customer-managed': use customer-managed CMK(s) provided below
   */
  readonly mode?: MailboxKmsMode | 'none';

  /**
   * Exclude specific resources from KMS usage.
   * Example: { mode: 'aws-managed', excluded: ['s3'] } keeps S3 on SSE-S3, while Dynamo/SQS remain KMS-encrypted.
   */
  readonly excluded?: MailboxKmsResource[];

  /**
   * Optional “one key for core resources” (regional).
   * Used when mode='customer-managed' and a perResource key isn't set.
   */
  readonly key?: kms.IKey;

  /** Optional per-resource overrides. */
  readonly perResource?: MailboxKmsPerResourceConfig;
}

export function mailboxKmsMode(config?: MailboxKmsConfig): MailboxKmsMode {
  const mode = config?.mode ?? 'aws-managed';
  if (mode === 'none') return 'aws-managed';
  return mode;
}

export function mailboxKmsDisabled(config?: MailboxKmsConfig): boolean {
  return config?.mode === 'none';
}

export function mailboxKmsExcluded(resource: MailboxKmsResource, config?: MailboxKmsConfig): boolean {
  if (mailboxKmsDisabled(config)) return true;
  return (config?.excluded ?? []).includes(resource);
}

function awsManagedAlias(scope: Construct, id: string, aliasName: string): kms.IKey {
  const existing = scope.node.tryFindChild(id);
  if (existing) return existing as unknown as kms.IKey;
  return kms.Alias.fromAliasName(scope, id, aliasName);
}

export function resolveEmailBucketKey(scope: Construct, config?: MailboxKmsConfig): kms.IKey | undefined {
  if (mailboxKmsExcluded('s3', config)) return undefined;

  if (mailboxKmsMode(config) === 'aws-managed') {
    return awsManagedAlias(scope, 'aws-managed-kms-s3', 'alias/aws/s3');
  }

  return config?.perResource?.emailBucket ?? config?.key;
}

export function resolveDynamoTablesKey(scope: Construct, config?: MailboxKmsConfig): kms.IKey | undefined {
  if (mailboxKmsExcluded('dynamodb', config)) return undefined;

  if (mailboxKmsMode(config) === 'aws-managed') {
    // DynamoDB's AWS-managed key. We don't strictly need the IKey (TableEncryption.AWS_MANAGED works without it),
    // but returning it is useful for any downstream constructs that want an explicit key reference.
    return awsManagedAlias(scope, 'aws-managed-kms-dynamodb', 'alias/aws/dynamodb');
  }

  return config?.perResource?.dynamoTables ?? config?.key;
}

export function resolveQueuesKey(scope: Construct, config?: MailboxKmsConfig): kms.IKey | undefined {
  if (mailboxKmsExcluded('sqs', config)) return undefined;

  if (mailboxKmsMode(config) === 'aws-managed') {
    return awsManagedAlias(scope, 'aws-managed-kms-sqs', 'alias/aws/sqs');
  }

  return config?.perResource?.queues ?? config?.key;
}
