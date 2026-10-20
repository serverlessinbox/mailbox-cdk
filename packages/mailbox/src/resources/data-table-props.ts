import { isDevelopmentMode } from '@serverlessinbox/mailbox-cdk-shared';
import { StackNamedTable }   from '@serverlessinbox/mailbox-cdk-shared';
import { TableEncryption }   from 'aws-cdk-lib/aws-dynamodb';
import type * as kms         from 'aws-cdk-lib/aws-kms';
import { Construct }         from 'constructs';

/**
 * Encryption configuration for DynamoDB tables.
 * Specifies the encryption mode and optional KMS key.
 */
export interface DynamoTableEncryptionProps {
  readonly encryption: TableEncryption;
  readonly encryptionKey?: kms.IKey;
}

/**
 * Explicit props for data-tier DynamoDB tables.
 * Restricts configurability to encryption settings only; table schema is fixed internally.
 */
export interface DataTableProps {
  /**
   * Base name for resource naming. Required and always provided by the enclosing data stack.
   */
  readonly nameBase: string;

  /**
   * Encryption configuration for the table.
   * Specifies the encryption mode (AWS-managed, customer-managed, or default).
   */
  readonly encryption: TableEncryption;

  /**
   * Optional customer-managed KMS key for encryption.
   * Only present when `encryption` is `TableEncryption.CUSTOMER_MANAGED`.
   */
  readonly encryptionKey?: kms.IKey;
}

/**
 * Shared table props extracted from DataTableProps for use across all data tables.
 * Includes nameBase, encryption configuration, and point-in-time recovery settings.
 * @internal Not exported; for use only within data table constructors.
 */
type DataTableCommonProps = Pick<
  ConstructorParameters<typeof StackNamedTable>[2],
  'nameBase' | 'encryption' | 'encryptionKey' | 'pointInTimeRecoverySpecification'
>;

/**
 * Extract shared, non-schema table props from DataTableProps.
 * Returns nameBase, encryption settings, and default point-in-time recovery spec
 * (enabled outside development mode).
 * @internal For use only within data table constructors.
 */
export function dataTableProps(scope: Construct, props: DataTableProps): DataTableCommonProps {
  return {
    nameBase: props.nameBase,
    encryption: props.encryption,
    ...(props.encryptionKey && { encryptionKey: props.encryptionKey }),
    pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: !isDevelopmentMode(scope) },
  };
}
