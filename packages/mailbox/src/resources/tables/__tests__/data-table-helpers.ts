import { TableEncryption }     from 'aws-cdk-lib/aws-dynamodb';
import type * as kms           from 'aws-cdk-lib/aws-kms';
import { App, Stack }          from 'aws-cdk-lib';

import type { DataTableProps } from '../data-table-props';

/** Props of a data table in production mode with the default encryption. */
export const DATA_TABLE_PROPS: DataTableProps = {
  nameBase:                   'base',
  encryption:                 TableEncryption.DEFAULT,
  pointInTimeRecoveryEnabled: true,
};

/** A stack with an explicit environment, as the data stack is synthesized. */
export function createDataTableStack(): Stack {
  return new Stack(new App(), 'TestStack', { env: { account: '123456789012', region: 'us-west-2' } });
}

/** Props that differ from DATA_TABLE_PROPS in every setting a table takes from them. */
export function propsWithKey(encryptionKey: kms.IKey): DataTableProps {
  return {
    nameBase:                   'custom',
    encryption:                 TableEncryption.CUSTOMER_MANAGED,
    pointInTimeRecoveryEnabled: false,
    encryptionKey,
  };
}
