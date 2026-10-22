import { TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import type * as kms       from 'aws-cdk-lib/aws-kms';

/**
 * Encryption configuration for DynamoDB tables.
 * Specifies the encryption mode and optional KMS key.
 */
export interface DynamoTableEncryptionProps {
  readonly encryption: TableEncryption;

  /** Only present when `encryption` is `TableEncryption.CUSTOMER_MANAGED`. */
  readonly encryptionKey?: kms.IKey;
}

/**
 * Explicit props for data-tier DynamoDB tables.
 * Restricts configurability to naming, encryption and recovery settings; table schema is fixed internally.
 */
export interface DataTableProps extends DynamoTableEncryptionProps {
  /**
   * Base name for resource naming. Required and always provided by the enclosing data stack.
   */
  readonly nameBase: string;

  /**
   * Whether point-in-time recovery is enabled on the table.
   */
  readonly pointInTimeRecoveryEnabled: boolean;
}
